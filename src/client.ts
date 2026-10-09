import { detectDevice } from "./device"
import { StudioError } from "./errors"
import { request, type FetchLike } from "./http"
import { defaultStorage, type StudioStorage } from "./storage"
import type {
  Announcement,
  ConversationMessage,
  DeviceContext,
  FeedbackSummary,
  FormField,
  Installation,
  ScreenshotContentType,
  ScreenshotInput,
  StartSupportInput,
  StartSupportResult,
  SubmitFeedbackInput,
  SubmitFeedbackResult,
} from "./types"

export const SDK_NAME = "panelui-studio"
export const SDK_VERSION = "0.2.1"

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

const SCREENSHOT_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp"]

function contentTypeFor(uri: string): ScreenshotContentType {
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
    submit: async (input: SubmitFeedbackInput): Promise<SubmitFeedbackResult> => {
      const { country, ...rest } = input
      return this.#call<SubmitFeedbackResult>("/feedback", {
        method: "POST",
        body: {
          ...rest,
          // Country travels with the rest of the device context, which is
          // where the API reads it from.
          ...(country ? { device: { ...this.#config.device, country } } : {}),
          sdk: { name: SDK_NAME, version: SDK_VERSION },
        },
      })
    },

    /** This install's own feedback and support conversations, newest first. */
    list: async (): Promise<FeedbackSummary[]> => {
      const data = await this.#call<{ feedback: FeedbackSummary[] }>("/feedback")
      return data.feedback
    },

    /** The project's custom form fields, to render next to the message. Empty when there are none. */
    form: async (): Promise<FormField[]> => {
      const data = await this.#call<{ fields: FormField[] }>("/form")
      return data.fields
    },
  }

  readonly support = {
    /**
     * Starts a support conversation. It lands in the project's Support inbox,
     * and the reply thread works like any other: `conversations.messages(id)`.
     */
    start: async (input: StartSupportInput | string): Promise<StartSupportResult> => {
      const { country, ...rest } = typeof input === "string" ? { message: input } : input
      return this.#call<StartSupportResult>("/support", {
        method: "POST",
        body: {
          ...rest,
          ...(country ? { device: { ...this.#config.device, country } } : {}),
          sdk: { name: SDK_NAME, version: SDK_VERSION },
        },
      })
    },
  }

  readonly announcements = {
    /** Announcements this install should show now: live, for its platform, not dismissed. */
    list: async (): Promise<Announcement[]> => {
      const data = await this.#call<{ announcements: Announcement[] }>("/announcements")
      return data.announcements
    },
    /** Records that the announcement was shown, for the project's view count. */
    seen: async (id: string): Promise<void> => {
      await this.#call(`/announcements/${encodeURIComponent(id)}/seen`, { method: "POST" })
    },
    /** Closes it for this install; it won't be listed again. */
    dismiss: async (id: string): Promise<void> => {
      await this.#call(`/announcements/${encodeURIComponent(id)}/dismiss`, { method: "POST" })
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
     * storage, then pass the id with the submission. Every plan has
     * screenshots; a full workspace fails with `storage_full`.
     */
    screenshot: async (input: ScreenshotInput): Promise<string> => {
      const { blob, contentType } =
        "file" in input ? fileBlob(input.file, input.contentType) : await this.#uriBlob(input)
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

  /**
   * The file's bytes, typed as what was signed. React Native sends a blob's
   * own type as the PUT's Content-Type, over any header passed, and a blob
   * read from a file has none — so an untyped one fails the signature.
   */
  async #uriBlob(input: { uri: string; contentType?: ScreenshotContentType }) {
    const contentType = input.contentType ?? contentTypeFor(input.uri)
    return { blob: await this.#readBlob(input.uri, contentType), contentType }
  }

  async #readBlob(uri: string, contentType: string): Promise<Blob> {
    // Capture libraries (react-native-view-shot on iOS) hand back bare paths.
    const url = uri.startsWith("/") ? `file://${uri}` : uri
    const response = await this.#config.fetchImpl(url)
    if (!response.ok) {
      throw new StudioError("bad_request", `Couldn't read the file at ${uri}.`, {
        status: response.status,
      })
    }
    const blob = await response.blob()
    return blob.type === contentType ? blob : new Blob([blob], { type: contentType })
  }
}

/**
 * A picked file, typed as what will be signed. Checked here, before asking for
 * an upload URL, so a PDF from a file input fails with a clear message.
 */
function fileBlob(file: Blob, contentType?: ScreenshotContentType): { blob: Blob; contentType: string } {
  const type = contentType ?? file.type
  if (!SCREENSHOT_TYPES.includes(type)) {
    throw new StudioError(
      "bad_request",
      `Screenshots must be PNG, JPEG or WebP${type ? `, not ${type}` : ""}.`
    )
  }
  return { blob: file.type === type ? file : new Blob([file], { type }), contentType: type }
}

/** Creates a client for one Studio project. */
export function createStudio(config: StudioConfig): StudioClient {
  return new StudioClient(config)
}
