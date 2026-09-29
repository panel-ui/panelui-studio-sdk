/** Error codes the Studio API returns. See docs/api.md. */
export type StudioErrorCode =
  | "bad_request"
  | "invalid_json"
  | "unauthorized"
  | "invalid_installation"
  | "quota_exceeded"
  | "feature_unavailable"
  | "not_found"
  | "payload_too_large"
  | "rate_limited"
  | "storage_unavailable"
  | "storage_full"
  | "internal_error"
  | "network_error"
  | "timeout"

/**
 * Every failure from the SDK, with the API's own code attached.
 *
 * Apps branch on `code`, never on the message: messages are written for
 * people and change, codes are part of the contract.
 */
export class StudioError extends Error {
  readonly code: StudioErrorCode
  readonly status: number
  /** Seconds to wait, from `Retry-After`, when the code is `rate_limited`. */
  readonly retryAfter?: number

  constructor(
    code: StudioErrorCode,
    message: string,
    options: { status?: number; retryAfter?: number; cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = "StudioError"
    this.code = code
    this.status = options.status ?? 0
    if (options.retryAfter !== undefined) this.retryAfter = options.retryAfter
  }

  /** True when trying the same call again later can succeed. */
  get retryable(): boolean {
    return (
      this.code === "rate_limited" ||
      this.code === "timeout" ||
      this.code === "network_error" ||
      this.status >= 500
    )
  }
}

export function isStudioError(error: unknown): error is StudioError {
  return error instanceof StudioError
}
