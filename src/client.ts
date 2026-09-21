import { detectDevice } from "./device"
import { StudioError } from "./errors"
import { request, type FetchLike } from "./http"
import { defaultStorage, type StudioStorage } from "./storage"
import type {
  ConversationMessage,
  DeviceContext,
  FeedbackSummary,
  Installation,
  ScreenshotInput,
  SubmitFeedbackInput,
  SubmitFeedbackResult,
} from "./types"

export const SDK_NAME = "panelui-studio"
export const SDK_VERSION = "0.1.0"

const DEFAULT_BASE_URL = "https://studio.panelui.dev/api/v1"
const STORAGE_KEY = "panelui-studio.installation"
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024

export type StudioConfig = {
  /** The project's publishable key. Public by design; safe to ship. */
  publishableKey: string
  /** Override for self-hosted Studio. Include `/api/v1`. */
  baseUrl?: string
  /** Where the installation token is kept. Defaults to secure storage. */
  storage?: StudioStorage
  /** Overrides anything detected from the device. */
  device?: DeviceContext
  /** Per-request timeout. Uploads get three times this. */
  timeoutMs?: number
  /** Swap in your own fetch, for tests or a proxy. */
  fetch?: FetchLike
}

type Stored = { installationId: string; installationToken: string }

function requireKey(key: string): void {
  if (!/^pk_[a-z0-9]{16,64}$/i.test(key)) {
    throw new StudioError(
      "unauthorized",
      "That doesn't look like a Studio publishable key (pk_…). Copy it from your project's settings."
    )
  }
}

function contentTypeFor(uri: string): "image/png" | "image/jpeg" | "image/webp" {
  const lower = uri.split("?")[0]?.toLowerCase() ?? ""
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".webp")) return "image/webp"
  return "image/png"
}

/**
 * A Studio client for one project.
 *
 * Registration happens on demand: every call that needs an installation token
 * registers first if there isn't one yet, so an app can call `submit()` as its
 * very first interaction. The token is persisted, so this costs one extra
 * request per install, not per launch.
 */
export class StudioClient {
  readonly #config: Required<Pick<StudioConfig, "publishableKey" | "baseUrl" | "timeoutMs">> & {
    storage: StudioStorage
    device: DeviceContext | undefined
    fetchImpl: FetchLike
  }
  #installation: Stored | null = null
  #registering: Promise<Stored> | null = null

  constructor(config: StudioConfig) {
    requireKey(config.publishableKey)
    const fetchImpl = config.fetch ?? (globalThis as { fetch?: FetchLike }).fetch
    if (!fetchImpl) {
      throw new StudioError(
        "network_error",
        "No global fetch in this runtime. Pass `fetch` when creating the client."
      )
    }
    this.#config = {
      publishableKey: config.publishableKey,
      baseUrl: (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, ""),
      timeoutMs: config.timeoutMs ?? 10_000,
      storage: config.storage ?? defaultStorage(),
      device: config.device,
      fetchImpl,
    }
  }

  async #call<T>(
    path: string,
    init: { method?: "GET" | "POST"; body?: unknown; auth?: boolean; timeoutMs?: number } = {}
  ): Promise<T> {
    const installationToken =
      init.auth === false ? null : (await this.#ensureInstallation()).installationToken
    return request<T>({
      path,
      method: init.method ?? "GET",
      ...(init.body === undefined ? {} : { body: init.body }),
      installationToken,
      timeoutMs: init.timeoutMs ?? this.#config.timeoutMs,
      fetchImpl: this.#config.fetchImpl,
      publishableKey: this.#config.publishableKey,
      baseUrl: this.#config.baseUrl,
    })
  }

  async #ensureInstallation(): Promise<Stored> {
    if (this.#installation) return this.#installation
    // Concurrent first calls must not register twice.
    this.#registering ??= this.#loadOrRegister().finally(() => {
      this.#registering = null
    })
    return this.#registering
  }

  async #loadOrRegister(): Promise<Stored> {
    const raw = await this.#config.storage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<Stored>
        if (parsed.installationId && parsed.installationToken) {
          this.#installation = parsed as Stored
          return this.#installation
        }
      } catch {
        // Corrupt entry: fall through and register again.
      }
    }

    const device = { ...(await detectDevice()), ...this.#config.device }
    const created = await request<Installation>({
      path: "/installations",
      method: "POST",
      body: device,
      installationToken: null,
      timeoutMs: this.#config.timeoutMs,
      fetchImpl: this.#config.fetchImpl,
      publishableKey: this.#config.publishableKey,
      baseUrl: this.#config.baseUrl,
    })
    this.#installation = created
    await this.#config.storage.setItem(STORAGE_KEY, JSON.stringify(created))
    return created
  }

  /** Registers this install if it isn't registered yet. Safe to call often. */
  async register(): Promise<Installation> {
    return this.#ensureInstallation()
  }

  /** Forgets the stored installation. The next call registers a new one. */
  async reset(): Promise<void> {
    this.#installation = null
    await this.#config.storage.removeItem(STORAGE_KEY)
  }

  /** Attaches one of your users to this install, so feedback shows who sent it. */
  async identify(user: {
    id: string
    email?: string
    name?: string
  }): Promise<{ userId: string }> {
    return this.#call<{ userId: string }>("/identify", { method: "POST", body: user })
  }

  readonly feedback = {
    submit: async (input: SubmitFeedbackInput): Promise<SubmitFeedbackResult> =>
      this.#call<SubmitFeedbackResult>("/feedback", {
        method: "POST",
        body: { ...input, sdk: { name: SDK_NAME, version: SDK_VERSION } },
      }),

    /** This install's own feedback, newest first. */
    list: async (): Promise<FeedbackSummary[]> => {
      const data = await this.#call<{ feedback: FeedbackSummary[] }>("/feedback")
      return data.feedback
    },
  }

  readonly conversations = {
    /** The thread for one item. Reading marks developer replies as read. */
    messages: async (feedbackId: string): Promise<ConversationMessage[]> => {
      const data = await this.#call<{ messages: ConversationMessage[] }>(
        `/feedback/${encodeURIComponent(feedbackId)}/messages`
      )
      return data.messages
    },

    send: async (feedbackId: string, body: string): Promise<ConversationMessage> => {
      const data = await this.#call<{ message: ConversationMessage }>(
        `/feedback/${encodeURIComponent(feedbackId)}/messages`,
        { method: "POST", body: { body } }
      )
      return data.message
    },
  }

  readonly uploads = {
    /**
     * Uploads a screenshot and returns its id for `feedback.submit`.
     *
     * Three steps: ask Studio for a presigned URL, PUT the bytes straight to
     * storage, then pass the id with the submission. Pro and Team only.
     */
    screenshot: async (input: ScreenshotInput): Promise<string> => {
      const contentType = input.contentType ?? contentTypeFor(input.uri)
      const blob = await this.#readBlob(input.uri)
      const byteSize = input.byteSize ?? blob.size

      if (byteSize > MAX_SCREENSHOT_BYTES) {
        throw new StudioError(
          "payload_too_large",
          `Screenshots can be at most ${MAX_SCREENSHOT_BYTES / (1024 * 1024)} MB.`
        )
      }

      const presigned = await this.#call<{
        attachmentId: string
        uploadUrl: string
        headers: Record<string, string>
      }>("/uploads", { method: "POST", body: { contentType, byteSize } })

      const response = await this.#config.fetchImpl(presigned.uploadUrl, {
        method: "PUT",
        headers: presigned.headers,
        body: blob,
        signal: AbortSignal.timeout(this.#config.timeoutMs * 3),
      })
      if (!response.ok) {
        throw new StudioError("storage_unavailable", "The screenshot upload was rejected.", {
          status: response.status,
        })
      }
      return presigned.attachmentId
    },
  }

  async #readBlob(uri: string): Promise<Blob> {
    const response = await this.#config.fetchImpl(uri)
    if (!response.ok) {
      throw new StudioError("bad_request", `Couldn't read the file at ${uri}.`, {
        status: response.status,
      })
    }
    return response.blob()
  }
}

/** Creates a client for one Studio project. */
export function createStudio(config: StudioConfig): StudioClient {
  return new StudioClient(config)
}
