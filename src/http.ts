import { StudioError, type StudioErrorCode } from "./errors"

export type FetchLike = (
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string | Blob | ArrayBuffer
    signal?: AbortSignal
  }
) => Promise<Response>

export type RequestOptions = {
  method?: "GET" | "POST"
  body?: unknown
  /** The installation token, for every call except registration. */
  installationToken?: string | null
  timeoutMs: number
  fetchImpl: FetchLike
  publishableKey: string
  baseUrl: string
  path: string
}

const ERROR_CODES = new Set<string>([
  "bad_request",
  "invalid_json",
  "unauthorized",
  "invalid_installation",
  "quota_exceeded",
  "feature_unavailable",
  "not_found",
  "payload_too_large",
  "rate_limited",
  "storage_unavailable",
  "internal_error",
])

function codeFor(value: unknown, status: number): StudioErrorCode {
  if (typeof value === "string" && ERROR_CODES.has(value)) return value as StudioErrorCode
  return status >= 500 ? "internal_error" : "bad_request"
}

function retryAfterOf(response: Response): number | undefined {
  const header = response.headers.get("retry-after")
  if (!header) return undefined
  const seconds = Number(header)
  return Number.isFinite(seconds) ? seconds : undefined
}

/** One API call, with the API's error envelope turned into a StudioError. */
export async function request<T>(options: RequestOptions): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.publishableKey}`,
    Accept: "application/json",
  }
  if (options.installationToken) {
    headers["X-Studio-Installation"] = options.installationToken
  }
  if (options.body !== undefined) headers["Content-Type"] = "application/json"

  let response: Response
  try {
    response = await options.fetchImpl(`${options.baseUrl}${options.path}`, {
      method: options.method ?? "GET",
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(options.timeoutMs),
    })
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError"
    throw new StudioError(
      timedOut ? "timeout" : "network_error",
      timedOut
        ? `PanelUI Studio didn't answer within ${options.timeoutMs}ms.`
        : "Couldn't reach PanelUI Studio.",
      { cause }
    )
  }

  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch (cause) {
      throw new StudioError("internal_error", "PanelUI Studio returned invalid JSON.", {
        status: response.status,
        cause,
      })
    }
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } } | null)?.error
    throw new StudioError(
      codeFor(error?.code, response.status),
      error?.message ?? `PanelUI Studio returned HTTP ${response.status}.`,
      { status: response.status, retryAfter: retryAfterOf(response) }
    )
  }

  return payload as T
}
