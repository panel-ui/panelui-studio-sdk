# Changelog

Notable changes to `panelui-studio`, the client for PanelUI Studio. Newest
first. A `vX.Y.Z` release publishes that version to npm.

Releases up to 0.3.0 were tagged `sdk-vX.Y.Z` in the Studio repository, where
the SDK lived until it moved here.

## [Unreleased]

### Changed

- The README and type comments call Studio's top plan **Max**, its name since
  2026-10-12 (it was Team). Nothing in the client changes.

## [0.3.0] - 2026-10-10

### Added

- Web support: Next.js, React, Vite and Expo's web target. The package now
  ships a browser build with no React Native imports, so web bundlers build
  it; React Native and Expo pick the native build through the `react-native`
  export condition, with nothing to change.
- On the web each install keeps its token in `localStorage`
  (`browserStorage()`, also exported), falling back to memory where the
  browser blocks storage, and the device context comes from the browser: the
  OS and its version, the browser as `model`, and the locale.
- `uploads.screenshot({ file })` takes a `File` from `<input type="file">` or
  any `Blob`, typed by the file itself; anything but PNG, JPEG or WebP is
  refused before an upload starts.

### Fixed

- `panelui-studio/react` keeps its `"use client"` directive, so a Next.js
  server layout can render `<StudioProvider>`.
- Requests no longer fail in browsers with "Illegal invocation": the client
  called its `fetch` as a method of its config object.
- `error.retryAfter` is readable from a browser, now that Studio exposes the
  `Retry-After` header.

## [0.2.1] - 2026-10-01

### Fixed

- `uploads.screenshot()` works from React Native: it accepts the bare file
  path `react-native-view-shot` returns on iOS, and uploads the bytes with
  the signed content type. React Native sends a blob's own type over the
  request header, and a file read through `fetch` has none, so every
  upload failed with `storage_unavailable` before.

## [0.2.0] - 2026-09-30

### Added

- `feedback.form()` and `submit({ fields })` for a project's custom feedback
  form, with the `useFeedbackForm()` hook.
- `support.start(message)` to open a support conversation.
- `announcements.list()`, `.seen(id)` and `.dismiss(id)`, with the
  `useAnnouncements()` hook.
- `feedback.list()` marks each item's `kind` (`feedback` or `support`).

## [0.1.1] - 2026-09-29

### Added

- The `storage_full` error code, for a workspace whose screenshot storage
  is full.

### Changed

- Screenshots are on every plan (1 per report on Free, 3 on Pro and Team);
  the docs moved to the Studio section at panelui.dev/docs/studio.

## [0.1.0] - 2026-09-28

### Added

- The first release: a client for any React Native or Expo app —
  registration, identity, feedback, conversations and screenshot uploads —
  plus `panelui-studio/react` with `StudioProvider`, `useFeedbackList` and
  `useConversation`.
