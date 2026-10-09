"use client"

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

// The package's own name, not `../client`: the hooks must share the app's copy
// of the client, whichever build (web or native) its bundler picked.
import {
  createStudio,
  StudioClient,
  StudioError,
  type Announcement,
  type ConversationMessage,
  type FeedbackSummary,
  type FormField,
  type StudioConfig,
  type SubmitFeedbackInput,
} from "panelui-studio"

const StudioContext = createContext<StudioClient | null>(null)

export type StudioProviderProps = { children: ReactNode } & (
  | { client: StudioClient }
  | StudioConfig
)

/**
 * Provides one client to the tree.
 *
 * Takes either a ready `client` — share one across a monorepo, or hand a fake
 * to tests — or the config to build one. It is built once, in a lazy state
 * initializer, so a re-render never re-registers the install.
 */
export function StudioProvider({ children, ...props }: StudioProviderProps) {
  const [client] = useState(() =>
    "client" in props ? props.client : createStudio(props as StudioConfig)
  )
  return createElement(StudioContext.Provider, { value: client }, children)
}

export function useStudio(): StudioClient {
  const client = useContext(StudioContext)
  if (!client) {
    throw new Error("useStudio must be used inside <StudioProvider>.")
  }
  return client
}

function asStudioError(error: unknown): StudioError {
  return error instanceof StudioError
    ? error
    : new StudioError("network_error", "Something went wrong.", { cause: error })
}

/**
 * This install's own feedback.
 *
 * Nothing polls here: a list of your own submissions rarely changes while you
 * look at it, and polling costs battery and quota. Pull-to-refresh calls
 * `reload`, which is why it returns a promise.
 *
 * The effect fetches inline rather than calling `reload`, because React's
 * compiler rules want state set from a promise callback, not from a helper
 * the effect body invokes. The four duplicated lines buy cancellation on
 * unmount, which the imperative path doesn't need.
 */
export function useFeedbackList(): {
  items: FeedbackSummary[]
  isLoading: boolean
  error: StudioError | null
  reload: () => Promise<void>
  submit: (input: SubmitFeedbackInput) => Promise<void>
} {
  const studio = useStudio()
  const [items, setItems] = useState<FeedbackSummary[] | null>(null)
  const [error, setError] = useState<StudioError | null>(null)

  useEffect(() => {
    let cancelled = false
    void studio.feedback.list().then(
      (next) => {
        if (!cancelled) {
          setItems(next)
          setError(null)
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setItems((current) => current ?? [])
          setError(asStudioError(cause))
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [studio])

  const reload = useCallback(
    () =>
      studio.feedback.list().then(
        (next) => {
          setItems(next)
          setError(null)
        },
        (cause: unknown) => {
          setItems((current) => current ?? [])
          setError(asStudioError(cause))
        }
      ),
    [studio]
  )

  const submit = useCallback(
    async (input: SubmitFeedbackInput) => {
      await studio.feedback.submit(input)
      await reload()
    },
    [studio, reload]
  )

  return {
    items: items ?? [],
    isLoading: items === null && error === null,
    error,
    reload,
    submit,
  }
}

/**
 * One conversation, with optional polling.
 *
 * Replies reach apps over plain HTTP, so a thread someone is reading is the
 * one place polling earns its cost; `pollMs: 0` turns it off. Loaded messages
 * carry the id they belong to, so switching threads shows a load rather than
 * the previous thread's messages.
 */
export function useConversation(
  feedbackId: string | null,
  options: { pollMs?: number } = {}
): {
  messages: ConversationMessage[]
  isLoading: boolean
  isSending: boolean
  error: StudioError | null
  send: (body: string) => Promise<void>
  reload: () => Promise<void>
} {
  const studio = useStudio()
  const pollMs = options.pollMs ?? 15_000
  const [loaded, setLoaded] = useState<{ id: string; messages: ConversationMessage[] } | null>(null)
  const [isSending, setSending] = useState(false)
  const [error, setError] = useState<StudioError | null>(null)

  useEffect(() => {
    if (!feedbackId) return
    let cancelled = false

    const fetchOnce = () =>
      void studio.conversations.messages(feedbackId).then(
        (messages) => {
          if (!cancelled) {
            setLoaded({ id: feedbackId, messages })
            setError(null)
          }
        },
        (cause: unknown) => {
          if (!cancelled) setError(asStudioError(cause))
        }
      )

    fetchOnce()
    if (pollMs <= 0) {
      return () => {
        cancelled = true
      }
    }
    const timer = setInterval(fetchOnce, pollMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [studio, feedbackId, pollMs])

  const reload = useCallback(async () => {
    if (!feedbackId) return
    await studio.conversations.messages(feedbackId).then(
      (messages) => {
        setLoaded({ id: feedbackId, messages })
        setError(null)
      },
      (cause: unknown) => {
        setError(asStudioError(cause))
      }
    )
  }, [studio, feedbackId])

  const send = useCallback(
    async (body: string) => {
      if (!feedbackId) return
      setSending(true)
      try {
        const message = await studio.conversations.send(feedbackId, body)
        // Shown straight away; the next poll reconciles with the server.
        setLoaded((current) =>
          current && current.id === feedbackId
            ? { id: feedbackId, messages: [...current.messages, message] }
            : current
        )
      } catch (cause) {
        setError(asStudioError(cause))
        throw cause
      } finally {
        setSending(false)
      }
    },
    [studio, feedbackId]
  )

  const messages = loaded && loaded.id === feedbackId ? loaded.messages : null

  return {
    messages: messages ?? [],
    isLoading: feedbackId !== null && messages === null && error === null,
    isSending,
    error,
    send,
    reload,
  }
}

/**
 * The project's custom form, loaded once. `fields` is empty until it loads
 * and when the project has no form, so rendering it is always safe.
 */
export function useFeedbackForm(): { fields: FormField[]; isLoading: boolean; error: StudioError | null } {
  const studio = useStudio()
  const [fields, setFields] = useState<FormField[] | null>(null)
  const [error, setError] = useState<StudioError | null>(null)

  useEffect(() => {
    let cancelled = false
    void studio.feedback.form().then(
      (next) => {
        if (!cancelled) setFields(next)
      },
      (cause: unknown) => {
        if (!cancelled) {
          setFields([])
          setError(asStudioError(cause))
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [studio])

  return { fields: fields ?? [], isLoading: fields === null && error === null, error }
}

/**
 * Live announcements for this install. `dismiss` hides one straight away and
 * tells Studio; `seen` records a view without hiding it.
 */
export function useAnnouncements(): {
  announcements: Announcement[]
  isLoading: boolean
  error: StudioError | null
  seen: (id: string) => Promise<void>
  dismiss: (id: string) => Promise<void>
  reload: () => Promise<void>
} {
  const studio = useStudio()
  const [items, setItems] = useState<Announcement[] | null>(null)
  const [error, setError] = useState<StudioError | null>(null)

  useEffect(() => {
    let cancelled = false
    void studio.announcements.list().then(
      (next) => {
        if (!cancelled) setItems(next)
      },
      (cause: unknown) => {
        if (!cancelled) {
          setItems((current) => current ?? [])
          setError(asStudioError(cause))
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [studio])

  const reload = useCallback(
    () =>
      studio.announcements.list().then(
        (next) => {
          setItems(next)
          setError(null)
        },
        (cause: unknown) => setError(asStudioError(cause))
      ),
    [studio]
  )

  const seen = useCallback(
    async (id: string) => {
      setItems((current) => current?.map((a) => (a.id === id ? { ...a, seen: true } : a)) ?? current)
      await studio.announcements.seen(id)
    },
    [studio]
  )

  const dismiss = useCallback(
    async (id: string) => {
      setItems((current) => current?.filter((a) => a.id !== id) ?? current)
      await studio.announcements.dismiss(id)
    },
    [studio]
  )

  return { announcements: items ?? [], isLoading: items === null && error === null, error, seen, dismiss, reload }
}
