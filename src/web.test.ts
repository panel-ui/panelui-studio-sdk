import { afterEach, describe, expect, it, vi } from "vitest"

import { createStudio } from "./client"
import { browserFromUserAgent, detectDevice, osFromUserAgent } from "./device"
import type { FetchLike } from "./http"
import { asyncStorage, browserStorage, secureStore } from "./storage"

const KEY = "pk_abcdefghijklmnop0123"
const REGISTERED = { installationId: "inst_1", installationToken: "it_" + "a".repeat(32) }

/** A `localStorage` stand-in, or one that throws like blocked site data. */
function fakeLocalStorage(blocked = false) {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (blocked) throw new DOMException("blocked", "SecurityError")
      map.set(key, value)
    },
    removeItem: (key: string) => void map.delete(key),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("browserStorage", () => {
  it("keeps values in localStorage", async () => {
    const local = fakeLocalStorage()
    vi.stubGlobal("window", {})
    vi.stubGlobal("localStorage", local)

    const storage = browserStorage()
    await storage.setItem("k", "v")

    expect(local.map.get("k")).toBe("v")
    expect(await browserStorage().getItem("k")).toBe("v")
  })

  it("falls back to memory when localStorage refuses writes", async () => {
    vi.stubGlobal("window", {})
    vi.stubGlobal("localStorage", fakeLocalStorage(true))

    const storage = browserStorage()
    await storage.setItem("k", "v")

    expect(await storage.getItem("k")).toBe("v")
  })

  it("doesn't touch localStorage while server rendering", async () => {
    const local = fakeLocalStorage()
    vi.stubGlobal("localStorage", local)

    await browserStorage().setItem("k", "v")

    expect(local.map.size).toBe(0)
  })
})

describe("the default storage on the web", () => {
  it("keeps the install across page loads", async () => {
    vi.stubGlobal("window", {})
    vi.stubGlobal("localStorage", fakeLocalStorage())
    const registrations: string[] = []
    const fetchImpl: FetchLike = async (url) => {
      if (url.endsWith("/installations")) registrations.push(url)
      return new Response(JSON.stringify(url.endsWith("/installations") ? REGISTERED : { feedback: [] }), {
        status: url.endsWith("/installations") ? 201 : 200,
      })
    }
    const load = () =>
      createStudio({ publishableKey: KEY, baseUrl: "https://studio.test/api/v1", fetch: fetchImpl, device: {} })

    await load().feedback.list()
    await load().feedback.list()

    expect(registrations).toHaveLength(1)
  })

  it("explains that secure storage is native only", () => {
    expect(() => secureStore().getItem("k")).toThrow(/browserStorage/)
    expect(() => asyncStorage().setItem("k", "v")).toThrow(/only available in React Native/)
  })
})

describe("detectDevice in a browser", () => {
  it("returns nothing outside a browser", async () => {
    vi.stubGlobal("navigator", { userAgent: "Node.js/24", language: "en-US" })
    expect(await detectDevice()).toEqual({})
  })

  it("reads client hints when the browser has them", async () => {
    vi.stubGlobal("window", {})
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0.0.0 Safari/537.36",
      language: "de-DE",
      userAgentData: {
        platform: "Windows",
        brands: [
          { brand: "Not=A?Brand", version: "8" },
          { brand: "Chromium", version: "129" },
          { brand: "Google Chrome", version: "129" },
        ],
        getHighEntropyValues: async () => ({ platformVersion: "15.0.0" }),
      },
    })

    expect(await detectDevice()).toEqual({
      platform: "web",
      osName: "Windows",
      osVersion: "11",
      model: "Chrome 129",
      locale: "de-DE",
      country: "DE",
    })
  })

  it("falls back to the user agent string", async () => {
    vi.stubGlobal("window", {})
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      language: "fr",
    })

    expect(await detectDevice()).toEqual({
      platform: "web",
      osName: "iOS",
      osVersion: "18.1",
      model: "Safari 18",
      locale: "fr",
    })
  })
})

describe("user agent parsing", () => {
  it.each([
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", 0, "macOS", "10.15.7"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", 5, "iPadOS", undefined],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/129.0.0.0 Mobile Safari/537.36", 5, "Android", "14"],
    ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) Chrome/129.0.0.0 Safari/537.36", 0, "ChromeOS", undefined],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", 0, "Linux", undefined],
  ])("%s → %s", (ua, touch, name, version) => {
    expect(osFromUserAgent(ua, touch)).toEqual({ name, version })
  })

  it.each([
    ["Mozilla/5.0 (Windows NT 10.0) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0", "Edge 129"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", "Firefox 131"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) CriOS/130.0 Mobile/15E148 Safari/604.1", "Chrome 130"],
    ["Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.6 Safari/605.1.15", "Safari 17"],
  ])("%s → %s", (ua, browser) => {
    expect(browserFromUserAgent(ua)).toBe(browser)
  })
})
