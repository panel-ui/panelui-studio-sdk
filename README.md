# panelui-studio

The client for [PanelUI Studio](https://studio.panelui.dev): feedback, conversations and
screenshots for **any React Native or Expo app**. PanelUI is not required — if you
do use it, its components drop straight on top.

```sh
npm install panelui-studio
# optional, but recommended: the installation token is a per-device secret
npx expo install expo-secure-store
```

## Quickstart

```ts
import { createStudio } from "panelui-studio"

export const studio = createStudio({
  publishableKey: "pk_…", // from Project → Settings. Public by design.
})

await studio.feedback.submit({ message: "The workout screen freezes." })
```

That's it. The first call registers this install, stores its token and sends the
device context with the submission — no backend of your own, no account for your
users, no secret in the app.

## What it does

| | |
|---|---|
| `studio.register()` | Registers this install. Called for you on first use; safe to call again. |
| `studio.identify({ id, email, name })` | Attaches one of your users, so feedback shows who sent it. Optional. |
| `studio.feedback.submit(input)` | Sends feedback. Returns the item and any `warnings`. |
| `studio.feedback.list()` | This install's own submissions, newest first. |
| `studio.conversations.messages(id)` | The thread for one item. Reading marks replies as read. |
| `studio.conversations.send(id, body)` | A follow-up from the user. |
| `studio.uploads.screenshot({ uri })` | Uploads an image and returns an `attachmentId` for `submit`. Pro and Team. |
| `studio.reset()` | Forgets the install, e.g. on sign-out of a shared device. |

## React

```tsx
import { StudioProvider, useConversation, useFeedbackList } from "panelui-studio/react"

export function App() {
  return (
    <StudioProvider publishableKey="pk_…">
      <Inbox />
    </StudioProvider>
  )
}

function Inbox() {
  const { items, isLoading, error, reload, submit } = useFeedbackList()
  // …
}

function Thread({ id }: { id: string }) {
  // Replies arrive over plain HTTP, so a thread being read is polled.
  const { messages, isSending, send } = useConversation(id, { pollMs: 15_000 })
  // …
}
```

## With PanelUI

`Feedback.Submit` hands you the message; the SDK builds the rest of the payload.

```tsx
import { Feedback } from "panelui-native"
import { studio } from "./studio"

<Feedback>
  <Feedback.Content>
    <Feedback.Field placeholder="What went wrong?" />
    <Feedback.Footer>
      <Feedback.Cancel>Cancel</Feedback.Cancel>
      <Feedback.Submit
        onSubmit={async (message) => {
          await studio.feedback.submit({ message, screen: "/workout/start" })
          setOpen(false) // the dialog waits for you: sending can fail
        }}
      >
        Send
      </Feedback.Submit>
    </Feedback.Footer>
  </Feedback.Content>
</Feedback>
```

Rendering a thread with PanelUI's `Message` primitive needs no adapter — the shapes
already line up:

```tsx
const { messages } = useConversation(feedbackId)

messages.map((message) => (
  <Message key={message.id} align={message.author === "user" ? "end" : "start"}>
    <Message.Bubble>
      <Message.BubbleContent>{message.body}</Message.BubbleContent>
    </Message.Bubble>
  </Message>
))
```

## Screenshots

```ts
const attachmentId = await studio.uploads.screenshot({ uri: localFileUri })
await studio.feedback.submit({ message, attachmentIds: [attachmentId] })
```

Up to three per submission, 5 MB each, png/jpeg/webp. The bytes go straight from
the device to private storage with a short-lived signed URL; Studio never proxies
them.

## Errors

Every failure is a `StudioError` carrying the API's own `code`, so you can branch
on the cause instead of parsing a message:

```ts
import { isStudioError } from "panelui-studio"

try {
  await studio.feedback.submit({ message })
} catch (error) {
  if (isStudioError(error) && error.code === "quota_exceeded") {
    // This workspace used its monthly allowance.
  }
}
```

Codes: `quota_exceeded`, `rate_limited` (with `retryAfter` in seconds),
`feature_unavailable`, `unauthorized`, `invalid_installation`, `not_found`,
`payload_too_large`, `bad_request`, `storage_unavailable`, `internal_error`,
`network_error`, `timeout`. `error.retryable` tells you whether waiting helps.

## Configuration

```ts
createStudio({
  publishableKey: "pk_…",
  baseUrl: "https://studio.example.com/api/v1", // self-hosted Studio
  storage: memoryStorage(),                     // default: secure storage, then AsyncStorage
  device: { appVersion: "2.4.1" },              // overrides what's detected
  timeoutMs: 10_000,
  fetch: myFetch,                               // a proxy, or a stub in tests
})
```

**Device context** is detected automatically from React Native's `Platform` and,
when installed, `expo-device`, `expo-constants` and `expo-localization`. Nothing
is required: a missing module means a missing field, never a crash.

**Storage** keeps the installation token between launches. `expo-secure-store` is
used when present, then `@react-native-async-storage/async-storage`, then memory
(which registers a new install on every launch). Pass your own to control it.

## Platform support

Expo, bare React Native, and the browser. The API is plain HTTP with CORS open,
so anything that can `fetch` can talk to Studio — see
[the API reference](https://github.com/panel-ui/panelui-studio/blob/main/docs/api.md).

## License

MIT
