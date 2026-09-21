export { createStudio, StudioClient, SDK_NAME, SDK_VERSION, type StudioConfig } from "./client"
export { StudioError, isStudioError, type StudioErrorCode } from "./errors"
export {
  asyncStorage,
  defaultStorage,
  memoryStorage,
  secureStore,
  type StudioStorage,
} from "./storage"
export { detectDevice } from "./device"
export type {
  AppPlatform,
  ConversationMessage,
  DeviceContext,
  FeedbackStatus,
  FeedbackSummary,
  Installation,
  ScreenshotInput,
  SubmitFeedbackInput,
  SubmitFeedbackResult,
  SubmittedFeedback,
} from "./types"
