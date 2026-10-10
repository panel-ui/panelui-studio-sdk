# panelui-studio

The client for [PanelUI Studio](https://studio.panelui.dev): feedback, conversations and
screenshots for **React Native, Expo and web apps** (Next.js, React, Vite). PanelUI
is not required — if you do use it, its components drop straight on top in an app.

```sh
npm install panelui-studio
# in an Expo app, optional but recommended: the installation token is a per-device secret
npx expo install expo-secure-store
```

Bundlers pick the right build on their own: React Native and Expo get the native
one through the `react-native` export condition, and everything else — Next.js,
Vite, Expo's web target — gets a build with no React Native imports at all.

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
| `studio.uploads.screenshot({ uri })` | Uploads an image and returns an `attachmentId` for `submit`. 1 per report on Free, 3 on Pro and Team. |
| `studio.feedback.form()` | The project's custom form fields, to render next to the message. Send answers as `submit({ fields })`. Pro and Team. |
| `studio.support.start(message)` | Starts a support conversation; replies come through `conversations.messages(id)`. |
| `studio.announcements.list()` | Live announcements for this install. `seen(id)` records a view, `dismiss(id)` hides it for good. |
| `studio.reset()` | Forgets the install, e.g. on sign-out of a shared device. |

## React

```tsx
import {
  StudioProvider,
  useAnnouncements,
  useConversation,
  useFeedbackForm,
  useFeedbackList,
} from "panelui-studio/react"

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

function Form() {
  // The project's custom fields; empty when it has none.
  const { fields } = useFeedbackForm()
  // …
}

function Banner() {
  const { announcements, dismiss } = useAnnouncements()
  // …
}
```

### Next.js

`panelui-studio/react` is a client module, so a server layout can render
`<StudioProvider publishableKey={process.env.NEXT_PUBLIC_STUDIO_KEY!}>` directly.
To share a client created in `lib/studio.ts` instead, pass it from a client
component — a class instance can't cross from a server component:

```tsx
// app/providers.tsx
"use client"

import { StudioProvider } from "panelui-studio/react"
import { studio } from "@/lib/studio"

export function Providers({ children }: { children: React.ReactNode }) {
  return <StudioProvider client={studio}>{children}</StudioProvider>
}
```

With Vite, read the key from `import.meta.env.VITE_STUDIO_KEY`.

## With PanelUI

PanelUI's components are React Native components, so this is for apps; on the web,
build the form with your own components.

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

On the web, pass the image itself — a `File` from `<input type="file">`, or any
`Blob`:

```ts
const attachmentId = await studio.uploads.screenshot({ file: input.files[0] })
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
  storage: memoryStorage(),                     // default: see Storage below
  device: { appVersion: "2.4.1" },              // overrides what's detected
  timeoutMs: 10_000,
  fetch: myFetch,                               // a proxy, or a stub in tests
})
```

**Device context** is detected automatically. In an app it comes from React
Native's `Platform` and, when installed, `expo-device`, `expo-constants` and
`expo-localization`; nothing is required, and a missing module means a missing
field, never a crash. In a browser it comes from client hints or the user agent:
the OS and its version, the browser as `model` (`Chrome 129`) and the locale.
Browsers have no app version to read, so pass `device: { appVersion }`. During
server rendering nothing is detected and nothing is sent.

**Storage** keeps the installation token between launches. In an app,
`expo-secure-store` is used when present, then
`@react-native-async-storage/async-storage`, then memory (which registers a new
install on every launch). On the web it's `localStorage` (`browserStorage()`),
falling back to memory where the browser blocks it. Pass your own to control it.

## Platform support

Expo, bare React Native, and the web: Next.js, React, Vite and Expo's web target.
The API is plain HTTP with CORS open, so anything that can `fetch` can talk to
Studio — see
[the API reference](https://panelui.dev/docs/studio/api-reference).

## Development

```sh
npm ci
npm run typecheck
npm test
npm run build
```

The package ships two builds from one source. The default build is for
browsers and Node (Next.js, React, Vite, Expo's web target); the React Native
build is published under the `react-native` export condition, where
`foo.native.ts` replaces `foo.ts`. Only `.native.ts` files may import
`react-native` or `expo-*`, and each keeps the same exports as its web twin;
`scripts/check-web-build.mjs` fails the build otherwise. `panelui-studio/react`
imports the core as `panelui-studio`, so it follows whichever build the app
resolved, and keeps its `"use client"`.

The SDK is documented in the Studio section of the PanelUI docs. A change to
its public API updates those pages too, in both their App and Web versions.

## Releasing

Bump `version` in `package.json`, add the `CHANGELOG.md` entry, commit, then
publish a GitHub release tagged `vX.Y.Z`. `.github/workflows/publish.yml`
checks the tag against the version and publishes to npm with provenance.
Versions up to 0.3.0 were released from the Studio repository as `sdk-vX.Y.Z`.

## License

MIT
