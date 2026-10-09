/**
 * Where the installation token is kept between launches.
 *
 * The token is a per-device secret, so the default prefers secure storage and
 * only falls back when the app hasn't installed it. Sync and async
 * implementations both work.
 */
export type StudioStorage = {
  getItem(key: string): Promise<string | null> | string | null
  setItem(key: string, value: string): Promise<void> | void
  removeItem(key: string): Promise<void> | void
}

/** Lives for the lifetime of the process. Registers again on next launch. */
export function memoryStorage(): StudioStorage {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
}

type WebStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

/** `localStorage`, if this runtime has one and lets us write to it. */
function usableLocalStorage(): WebStorage | null {
  try {
    const storage = (globalThis as { localStorage?: WebStorage }).localStorage
    if (!storage) return null
    // Blocked site data and some private modes throw on write, not on access.
    const probe = "panelui-studio.probe"
    storage.setItem(probe, "1")
    storage.removeItem(probe)
    return storage
  } catch {
    return null
  }
}

/**
 * The browser's `localStorage`, so a web install survives a reload.
 *
 * Checked on first use rather than on creation, so a client built during
 * server rendering still picks it up in the browser. Where it's missing or
 * blocked, this keeps the token in memory instead.
 */
export function browserStorage(): StudioStorage {
  const fallback = memoryStorage()
  let resolved: StudioStorage | null = null
  const get = (): StudioStorage => {
    if (resolved) return resolved
    // Server rendering: don't settle on memory for good, and leave Node's own
    // `localStorage` alone.
    if (typeof window === "undefined") return fallback
    const storage = usableLocalStorage()
    if (!storage) return (resolved = fallback)
    return (resolved = {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, value),
      removeItem: (key) => storage.removeItem(key),
    })
  }

  return {
    getItem: (key) => get().getItem(key),
    setItem: (key, value) => get().setItem(key, value),
    removeItem: (key) => get().removeItem(key),
  }
}
