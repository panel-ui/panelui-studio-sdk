import { browserStorage, type StudioStorage } from "./storage-shared"

/**
 * The browser build. Nothing here imports React Native or Expo, so a web
 * bundler never has to resolve them; `storage.native.ts` is the app build.
 */
export { browserStorage, memoryStorage, type StudioStorage } from "./storage-shared"

function nativeOnly(name: string): StudioStorage {
  const fail = (): never => {
    throw new Error(
      `${name}() is only available in React Native and Expo apps. On the web, use browserStorage() or pass your own \`storage\`.`
    )
  }
  return { getItem: fail, setItem: fail, removeItem: fail }
}

/** `expo-secure-store`. Native only: on the web every call throws. */
export function secureStore(): StudioStorage {
  return nativeOnly("secureStore")
}

/** `@react-native-async-storage/async-storage`. Native only: on the web every call throws. */
export function asyncStorage(): StudioStorage {
  return nativeOnly("asyncStorage")
}

/** `localStorage` when the browser allows it, then memory. */
export function defaultStorage(): StudioStorage {
  return browserStorage()
}
