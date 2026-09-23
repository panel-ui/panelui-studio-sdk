import { describe, expect, it } from "vitest"

import { createStudio } from "./client"
import { StudioError } from "./errors"
import type { FetchLike } from "./http"
import { memoryStorage } from "./storage"

const KEY = "pk_abcdefghijklmnop0123"

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown }

/** A fetch stand-in that records calls and replays queued responses. */
function harness(
  routes: Record<string, () => Response>,
  fallback?: () => Response
): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = []
  const fetchImpl: FetchLike = async (url, init = {}) => {
    const method = init.method ?? "GET"
    const body =
      typeof init.body === "string" && init.body.length > 0 ? JSON.parse(init.body) : undefined
    calls.push({ url, method, headers: init.headers ?? {}, ...(body ? { body } : {}) })
    const key = `${method} ${new URL(url).pathname}`
    const route = routes[key] ?? fallback
    if (!route) throw new Error(`unexpected request: ${key}`)
    return route()
  }
  return { fetchImpl, calls }
}

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  })

const REGISTERED = { installationId: "inst_1", installationToken: "it_" + "a".repeat(32) }

function client(routes: Record<string, () => Response>, storage = memoryStorage()) {
  const { fetchImpl, calls } = harness(routes)
  return {
    calls,
    storage,
    studio: createStudio({
      publishableKey: KEY,
      baseUrl: "https://studio.test/api/v1",
      storage,
      fetch: fetchImpl,
      device: { platform: "ios", appVersion: "2.4.1" },
    }),
  }
}

describe("createStudio", () => {
  it("rejects anything that isn't a publishable key", () => {
    expect(() => createStudio({ publishableKey: "sk_secret" })).toThrow(StudioError)
    expect(() => createStudio({ publishableKey: "" })).toThrow(/publishable key/)
  })
})

describe("registration", () => {
  it("registers once, even when two calls race", async () => {
    const { studio, calls } = client({
      "POST /api/v1/installations": () => json(REGISTERED, { status: 201 }),
      "GET /api/v1/feedback": () => json({ feedback: [] }),
    })

    await Promise.all([studio.feedback.list(), studio.feedback.list(), studio.register()])

    const registrations = calls.filter((c) => c.url.endsWith("/installations"))
    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.body).toMatchObject({ platform: "ios", appVersion: "2.4.1" })
  })

  it("persists the installation and reuses it on the next launch", async () => {
    const storage = memoryStorage()
    const first = client({ "POST /api/v1/installations": () => json(REGISTERED, { status: 201 }) }, storage)
    await first.studio.register()

    // A new client with the same storage is a new app launch.
    const second = client({ "GET /api/v1/feedback": () => json({ feedback: [] }) }, storage)
    await second.studio.feedback.list()

    expect(second.calls.some((c) => c.url.endsWith("/installations"))).toBe(false)
    expect(second.calls[0]?.headers["X-Studio-Installation"]).toBe(REGISTERED.installationToken)
  })

  it("registers again when the stored entry is corrupt", async () => {
    const storage = memoryStorage()
    await storage.setItem("panelui-studio.installation", "{not json")
    const { studio, calls } = client(
      { "POST /api/v1/installations": () => json(REGISTERED, { status: 201 }) },
      storage
    )
    await studio.register()
    expect(calls.filter((c) => c.url.endsWith("/installations"))).toHaveLength(1)
  })

  it("forgets the installation on reset", async () => {
    const storage = memoryStorage()
    const { studio } = client(
      { "POST /api/v1/installations": () => json(REGISTERED, { status: 201 }) },
      storage
    )
    await studio.register()
    await studio.reset()
    expect(await storage.getItem("panelui-studio.installation")).toBeNull()
  })
})

describe("feedback", () => {
  const routes = {
    "POST /api/v1/installations": () => json(REGISTERED, { status: 201 }),
    "POST /api/v1/feedback": () =>
      json(
        {
          feedback: { id: "fb_1", number: 7, status: "new", createdAt: "2026-09-21T10:00:00Z" },
          warnings: [],
        },
        { status: 201 }
      ),
  }

  it("sends the key, the installation token and its own version", async () => {
    const { studio, calls } = client(routes)
    const result = await studio.feedback.submit({ message: "It freezes", rating: 2 })

    expect(result.feedback.number).toBe(7)
    const submit = calls.find((c) => c.url.endsWith("/feedback"))
    expect(submit?.headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(submit?.headers["X-Studio-Installation"]).toBe(REGISTERED.installationToken)
    expect(submit?.body).toMatchObject({
      message: "It freezes",
      rating: 2,
      sdk: { name: "panelui-studio" },
    })
  })

  it("sends an explicit country as device context", async () => {
    const { studio, calls } = client(routes)
    await studio.feedback.submit({ message: "hi", country: "JP" })
    const submit = calls.find((c) => c.url.endsWith("/feedback"))
    expect(submit?.body).toMatchObject({ message: "hi", device: { country: "JP" } })
    expect(submit?.body).not.toHaveProperty("country")
  })

  it("passes warnings through instead of throwing", async () => {
    const { studio } = client({
      ...routes,
      "POST /api/v1/feedback": () =>
        json(
          {
            feedback: { id: "fb_2", number: 8, status: "new", createdAt: "2026-09-21T10:00:00Z" },
            warnings: ["metadata_ignored: custom metadata requires the Pro plan."],
          },
          { status: 201 }
        ),
    })
    const result = await studio.feedback.submit({ message: "hi", metadata: { plan: "free" } })
    expect(result.warnings[0]).toContain("metadata_ignored")
  })
})

describe("errors", () => {
  it("surfaces the quota code", async () => {
    const { studio } = client({
      "POST /api/v1/installations": () => json(REGISTERED, { status: 201 }),
      "POST /api/v1/feedback": () =>
        json(
          { error: { code: "quota_exceeded", message: "Monthly allowance used." } },
          { status: 402 }
        ),
    })

    const error = await studio.feedback.submit({ message: "hi" }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StudioError)
    expect((error as StudioError).code).toBe("quota_exceeded")
    expect((error as StudioError).status).toBe(402)
    expect((error as StudioError).retryable).toBe(false)
  })

  it("reads Retry-After when rate limited", async () => {
    const { studio } = client({
      "POST /api/v1/installations": () => json(REGISTERED, { status: 201 }),
      "POST /api/v1/feedback": () =>
        json({ error: { code: "rate_limited", message: "Slow down." } }, {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "42" },
        }),
    })

    const error = (await studio.feedback
      .submit({ message: "hi" })
      .catch((e: unknown) => e)) as StudioError
    expect(error.code).toBe("rate_limited")
    expect(error.retryAfter).toBe(42)
    expect(error.retryable).toBe(true)
  })

  it("turns an unreachable host into a network error", async () => {
    const studio = createStudio({
      publishableKey: KEY,
      baseUrl: "https://studio.test/api/v1",
      storage: memoryStorage(),
      fetch: () => Promise.reject(new Error("ECONNREFUSED")),
    })
    const error = (await studio.register().catch((e: unknown) => e)) as StudioError
    expect(error.code).toBe("network_error")
    expect(error.retryable).toBe(true)
  })
})

describe("conversations", () => {
  it("lists and sends messages", async () => {
    const { studio, calls } = client({
      "POST /api/v1/installations": () => json(REGISTERED, { status: 201 }),
      "GET /api/v1/feedback/fb_1/messages": () =>
        json({
          messages: [
            { id: "msg_1", author: "developer", body: "Fixed in 1.4.3.", createdAt: "2026-09-21T10:00:00Z" },
          ],
        }),
      "POST /api/v1/feedback/fb_1/messages": () =>
        json(
          {
            message: {
              id: "msg_2",
              author: "user",
              body: "Thanks!",
              createdAt: "2026-09-21T10:05:00Z",
            },
          },
          { status: 201 }
        ),
    })

    const messages = await studio.conversations.messages("fb_1")
    expect(messages[0]?.author).toBe("developer")

    const sent = await studio.conversations.send("fb_1", "Thanks!")
    expect(sent.id).toBe("msg_2")
    expect(calls.at(-1)?.body).toEqual({ body: "Thanks!" })
  })

  it("escapes the feedback id in the path", async () => {
    const { studio, calls } = client(
      { "POST /api/v1/installations": () => json(REGISTERED, { status: 201 }) },
      memoryStorage()
    )
    await studio.conversations.messages("fb_1/../other").catch(() => undefined)
    expect(calls.at(-1)?.url).toContain("fb_1%2F..%2Fother")
  })
})

describe("uploads", () => {
  it("presigns, PUTs the bytes and returns the attachment id", async () => {
    const bytes = new Blob([new Uint8Array(64)], { type: "image/png" })
    const calls: Call[] = []
    const fetchImpl: FetchLike = async (url, init = {}) => {
      calls.push({ url, method: init.method ?? "GET", headers: init.headers ?? {} })
      if (url === "file:///tmp/shot.png") return new Response(bytes)
      if (url.endsWith("/installations")) return json(REGISTERED, { status: 201 })
      if (url.endsWith("/uploads")) {
        return json(
          {
            attachmentId: "att_1",
            uploadUrl: "https://r2.test/put",
            method: "PUT",
            headers: { "Content-Type": "image/png" },
            expiresAt: "2026-09-21T10:05:00Z",
          },
          { status: 201 }
        )
      }
      return new Response(null, { status: 200 })
    }

    const studio = createStudio({
      publishableKey: KEY,
      baseUrl: "https://studio.test/api/v1",
      storage: memoryStorage(),
      fetch: fetchImpl,
    })

    const id = await studio.uploads.screenshot({ uri: "file:///tmp/shot.png" })
    expect(id).toBe("att_1")

    const put = calls.find((c) => c.method === "PUT")
    expect(put?.url).toBe("https://r2.test/put")
    expect(put?.headers["Content-Type"]).toBe("image/png")
  })

  it("refuses an oversized screenshot before asking for a URL", async () => {
    const calls: string[] = []
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url)
      if (url.startsWith("file:")) return new Response(new Blob([new Uint8Array(8)]))
      return json(REGISTERED, { status: 201 })
    }
    const studio = createStudio({
      publishableKey: KEY,
      baseUrl: "https://studio.test/api/v1",
      storage: memoryStorage(),
      fetch: fetchImpl,
    })

    const error = (await studio.uploads
      .screenshot({ uri: "file:///tmp/big.png", byteSize: 9 * 1024 * 1024 })
      .catch((e: unknown) => e)) as StudioError

    expect(error.code).toBe("payload_too_large")
    expect(calls.some((url) => url.endsWith("/uploads"))).toBe(false)
  })
})
