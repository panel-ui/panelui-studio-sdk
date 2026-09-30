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
  /** ISO-3166-1 alpha-2. Filled from the device locale when not given. */
  country?: string
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
  /** Ids from `uploads.screenshot()`: 1 per report on Free, 3 on Pro and Team. */
  attachmentIds?: string[]
  /**
   * Answers to the project's custom form, keyed by field key (see
   * `feedback.form()`). Pro and Team. Required fields apply once you send any.
   */
  fields?: Record<string, FormAnswer>
  /**
   * Where this user is, as an ISO-3166-1 alpha-2 code.
   *
   * Pass it when your app already knows — a profile, a region picker, your own
   * settings. Left out, Studio falls back to the device locale's region and
   * then to the country of the request, so the dashboard's map still works.
   */
  country?: string
}

export type FormAnswer = string | number | boolean

/** One question on the project's custom feedback form. */
export type FormField = {
  key: string
  label: string
  type: "text" | "textarea" | "choice" | "checkbox" | "rating"
  /** The choices, for `choice` fields. */
  options: string[]
  required: boolean
}

/** Starting a support conversation: a message plus the context a report can carry. */
export type StartSupportInput = Omit<SubmitFeedbackInput, "rating" | "tags">

export type StartSupportResult = {
  conversation: SubmittedFeedback
  warnings: string[]
}

export type Announcement = {
  id: string
  title: string
  body: string
  /** A button to show with it, if the project set one. */
  cta: { label: string; url: string } | null
  /** When it stops showing, if it has an end. */
  endsAt: string | null
  /** Whether this install already marked it seen. */
  seen: boolean
  createdAt: string
}

export type SubmittedFeedback = {
  id: string
  number: number
  status: FeedbackStatus
  createdAt: string
}

export type SubmitFeedbackResult = {
  feedback: SubmittedFeedback
  /** Accepted, with something to know: `metadata_ignored`, `fields_ignored`, `tags_dropped`, `over_quota`. */
  warnings: string[]
}

export type FeedbackSummary = {
  id: string
  number: number
  /** "support" for conversations started with `support.start()`. */
  kind: "feedback" | "support"
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
