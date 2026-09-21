/** The platforms the API accepts for an installation. */
export type AppPlatform = "ios" | "android" | "web" | "other"

/** Everything the API can learn about the device an install runs on. */
export type DeviceContext = {
  platform?: AppPlatform
  osName?: string
  osVersion?: string
  model?: string
  locale?: string
  appVersion?: string
}

export type Installation = {
  installationId: string
  installationToken: string
}

export type FeedbackStatus = "new" | "in_progress" | "resolved" | "archived"

export type SubmitFeedbackInput = {
  message: string
  rating?: number
  tags?: string[]
  screen?: string
  appVersion?: string
  build?: string
  /** Pro and Team. Ignored on Free, which returns a warning instead. */
  metadata?: Record<string, unknown>
  /** Ids from `uploads.screenshot()`, up to three. */
  attachmentIds?: string[]
}

export type SubmittedFeedback = {
  id: string
  number: number
  status: FeedbackStatus
  createdAt: string
}

export type SubmitFeedbackResult = {
  feedback: SubmittedFeedback
  /** Accepted, but something was left out: `metadata_ignored`, `tags_dropped`. */
  warnings: string[]
}

export type FeedbackSummary = {
  id: string
  number: number
  message: string
  status: FeedbackStatus
  createdAt: string
  lastMessageAt: string | null
  /** How many replies a developer has sent. */
  replies: number
}

export type ConversationMessage = {
  id: string
  author: "user" | "developer"
  body: string
  createdAt: string
}

export type ScreenshotInput = {
  /** A local file uri (`file://…`) or anything `fetch` can read as a blob. */
  uri: string
  contentType?: "image/png" | "image/jpeg" | "image/webp"
  /** Bytes. Read from the file when omitted. Max 5 MB. */
  byteSize?: number
}
