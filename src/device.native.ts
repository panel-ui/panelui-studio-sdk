import type * as Web from "./device"
import { regionOf } from "./device-shared"
import type { AppPlatform, DeviceContext } from "./types"

type ReactNativeModule = {
  Platform: { OS: string; Version?: string | number }
}

function toPlatform(os: string | undefined): AppPlatform | undefined {
  if (os === "ios" || os === "android" || os === "web") return os
  return os ? "other" : undefined
}

/**
 * What we can learn about the device without asking the app for anything.
 *
 * The React Native and Expo build of `device.ts`. Every source is optional
 * and imported lazily, so a missing module means a missing field, never a
 * crash. Anything the app passes explicitly wins.
 */
export const detectDevice: typeof Web.detectDevice = async () => {
  const device: DeviceContext = {}

  try {
    const { Platform } = (await import("react-native")) as unknown as ReactNativeModule
    device.platform = toPlatform(Platform.OS)
    if (Platform.OS === "ios") device.osName = "iOS"
    if (Platform.OS === "android") device.osName = "Android"
    if (Platform.Version !== undefined) device.osVersion = String(Platform.Version)
  } catch {
    // Not a React Native runtime after all, e.g. Node running the app build.
  }

  try {
    const constants = (await import("expo-constants")) as unknown as {
      default?: {
        expoConfig?: { version?: string } | null
        deviceName?: string | null
      }
    }
    const version = constants.default?.expoConfig?.version
    if (version) device.appVersion = version
  } catch {
    /* expo-constants not installed */
  }

  try {
    const expoDevice = (await import("expo-device")) as unknown as {
      modelName?: string | null
      osName?: string | null
      osVersion?: string | null
    }
    if (expoDevice.modelName) device.model = expoDevice.modelName
    if (expoDevice.osName) device.osName = expoDevice.osName
    if (expoDevice.osVersion) device.osVersion = expoDevice.osVersion
  } catch {
    /* expo-device not installed */
  }

  try {
    const localization = (await import("expo-localization")) as unknown as {
      getLocales?: () => { languageTag?: string }[]
    }
    const tag = localization.getLocales?.()[0]?.languageTag
    if (tag) device.locale = tag
  } catch {
    /* expo-localization not installed */
  }

  if (!device.locale && typeof navigator !== "undefined") {
    const language = (navigator as { language?: string }).language
    if (language) device.locale = language
  }

  // The region the phone is configured for. A good guess at where someone is,
  // and free — unlike asking for location, which costs a permission prompt at
  // the worst possible moment. An app that knows better passes `country` to
  // submit() and that wins.
  const region = regionOf(device.locale)
  if (region) device.country = region

  return device
}
