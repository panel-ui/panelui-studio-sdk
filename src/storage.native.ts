import { memoryStorage, type StudioStorage } from "./storage-shared"
import type * as Web from "./storage"

/**
 * The React Native and Expo build of `storage.ts`. Same exports, so both
 * builds share one set of types; the bundler picks this file through the
 * package's `react-native` condition.
 */
export { browserStorage, memoryStorage, type StudioStorage } from "./storage-shared"

/** `expo-secure-store`, imported only if the app actually has it. */
export const secureStore: typeof Web.secureStore = () => {
  type SecureStore = {
    getItemAsync(key: string): Promise<string | null>
    setItemAsync(key: string, value: string): Promise<void>
    deleteItemAsync(key: string): Promise<void>
  }
  const load = async (): Promise<SecureStore> => {
    try {
      return (await import("expo-secure-store")) as unknown as SecureStore
    } catch {
      throw new Error(
        "secureStore() needs expo-secure-store. Run `npx expo install expo-secure-store`, or pass a different `storage`."
      )
    }
  }
  return {
    getItem: async (key) => (await load()).getItemAsync(key),
    setItem: async (key, value) => (await load()).setItemAsync(key, value),
    removeItem: async (key) => (await load()).deleteItemAsync(key),
  }
}

/** `@react-native-async-storage/async-storage`. Not encrypted at rest. */
export const asyncStorage: typeof Web.asyncStorage = () => {
  type AsyncStorage = {
    default: {
      getItem(key: string): Promise<string | null>
      setItem(key: string, value: string): Promise<void>
      removeItem(key: string): Promise<void>
    }
  }
  const load = async (): Promise<AsyncStorage["default"]> => {
    try {
      const mod = (await import(
        "@react-native-async-storage/async-storage"
      )) as unknown as AsyncStorage
      return mod.default
    } catch {
      throw new Error(
        "asyncStorage() needs @react-native-async-storage/async-storage. Install it, or pass a different `storage`."
      )
    }
  }
  return {
    getItem: async (key) => (await load()).getItem(key),
    setItem: async (key, value) => (await load()).setItem(key, value),
    removeItem: async (key) => (await load()).removeItem(key),
  }
}

/**
 * Secure storage when it's installed, then AsyncStorage, then memory.
 *
 * Resolved once, on first use, so a missing optional dependency costs nothing
 * at import time and never throws at module scope.
 */
export const defaultStorage: typeof Web.defaultStorage = () => {
  let resolved: Promise<StudioStorage> | null = null

  const pick = async (): Promise<StudioStorage> => {
    try {
      await import("expo-secure-store")
      return secureStore()
    } catch {
      /* not installed */
    }
    try {
      await import("@react-native-async-storage/async-storage")
      return asyncStorage()
    } catch {
      /* not installed */
    }
    return memoryStorage()
  }

  const get = () => (resolved ??= pick())

  return {
    getItem: async (key) => (await get()).getItem(key),
    setItem: async (key, value) => (await get()).setItem(key, value),
    removeItem: async (key) => (await get()).removeItem(key),
  }
}
