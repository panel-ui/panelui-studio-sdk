import { regionOf } from "./device-shared"
import type { DeviceContext } from "./types"

/**
 * The browser build. `device.native.ts` is the React Native and Expo one.
 *
 * A browser can't name the hardware, so `model` carries the browser and its
 * major version instead — the thing a bug report on the web most often turns
 * on. There's no app version to read either; pass it as `device.appVersion`.
 */

type UserAgentData = {
  platform?: string
  brands?: { brand: string; version: string }[]
  getHighEntropyValues?(hints: string[]): Promise<{ platformVersion?: string }>
}

type BrowserNavigator = {
  userAgent?: string
  language?: string
  maxTouchPoints?: number
  userAgentData?: UserAgentData
}

type Os = { name: string; version?: string }

const OS_FROM_HINT: Record<string, string> = {
  Android: "Android",
  "Chrome OS": "ChromeOS",
  "Chromium OS": "ChromeOS",
  iOS: "iOS",
  Linux: "Linux",
  macOS: "macOS",
  Windows: "Windows",
}

const WINDOWS_NT: Record<string, string> = { "10.0": "10", "6.3": "8.1", "6.2": "8", "6.1": "7" }

/** OS from the user agent string, for browsers without client hints (Safari, Firefox). */
export function osFromUserAgent(ua: string, maxTouchPoints = 0): Os | undefined {
  const ios = /\b(?:iPhone|iPad|iPod)\b.*? OS (\d+)[_.](\d+)(?:[_.](\d+))?/.exec(ua)
  if (ios) return { name: "iOS", version: ios.slice(1).filter(Boolean).join(".") }
  const android = /\bAndroid (\d+(?:\.\d+)*)/.exec(ua)
  if (android) return { name: "Android", version: android[1] }
  if (/\bCrOS\b/.test(ua)) return { name: "ChromeOS" }
  const windows = /\bWindows NT (\d+\.\d+)/.exec(ua)
  if (windows) return { name: "Windows", version: WINDOWS_NT[windows[1] ?? ""] }
  const mac = /\bMac OS X (\d+(?:[_.]\d+)*)/.exec(ua)
  if (mac) {
    // iPadOS asks for the desktop site and says it's a Mac; touch gives it away.
    if (maxTouchPoints > 1) return { name: "iPadOS" }
    return { name: "macOS", version: mac[1]?.replace(/_/g, ".") }
  }
  if (/\bLinux\b/.test(ua)) return { name: "Linux" }
  return undefined
}

/** `Chrome 129`, `Safari 18`, `Firefox 131`, … from the user agent string. */
export function browserFromUserAgent(ua: string): string | undefined {
  const patterns: [string, RegExp][] = [
    ["Edge", /\bEdg(?:e|A|iOS)?\/(\d+)/],
    ["Opera", /\b(?:OPR|OPT)\/(\d+)/],
    ["Samsung Internet", /\bSamsungBrowser\/(\d+)/],
    ["Firefox", /\b(?:Firefox|FxiOS)\/(\d+)/],
    ["Chrome", /\b(?:Chrome|CriOS)\/(\d+)/],
    ["Safari", /\bVersion\/(\d+).*\bSafari\//],
  ]
  for (const [name, pattern] of patterns) {
    const match = pattern.exec(ua)
    if (match) return `${name} ${match[1]}`
  }
  return undefined
}

/** The real brand from client hints, skipping the deliberately fake one. */
function browserFromBrands(brands: UserAgentData["brands"]): string | undefined {
  const real = (brands ?? []).filter((b) => !/not.?a.?brand/i.test(b.brand))
  const named = real.find((b) => b.brand !== "Chromium") ?? real[0]
  if (!named) return undefined
  const brand = named.brand.replace(/^Google /, "").replace(/^Microsoft /, "")
  return `${brand} ${named.version.split(".")[0]}`
}

/** Windows reports its build family in hints: 13 and up is Windows 11. */
function hintVersion(os: string, platformVersion: string | undefined): string | undefined {
  if (!platformVersion) return undefined
  if (os !== "Windows") return platformVersion
  const major = Number(platformVersion.split(".")[0])
  if (!Number.isFinite(major) || major === 0) return undefined
  return major >= 13 ? "11" : "10"
}

async function osFromHints(hints: UserAgentData): Promise<Os | undefined> {
  const name = hints.platform ? OS_FROM_HINT[hints.platform] : undefined
  if (!name) return undefined
  try {
    const high = await hints.getHighEntropyValues?.(["platformVersion"])
    return { name, version: hintVersion(name, high?.platformVersion) }
  } catch {
    return { name }
  }
}

/**
 * What we can learn about the browser without asking the app for anything.
 *
 * Returns nothing outside a browser: Node has a `navigator` of its own these
 * days, and a server render is not a web install. Anything the app passes
 * explicitly wins.
 */
export async function detectDevice(): Promise<DeviceContext> {
  if (typeof window === "undefined" || typeof navigator === "undefined") return {}
  const nav = navigator as BrowserNavigator
  const ua = nav.userAgent ?? ""
  const device: DeviceContext = { platform: "web" }

  const os = (nav.userAgentData && (await osFromHints(nav.userAgentData))) ?? osFromUserAgent(ua, nav.maxTouchPoints)
  if (os) {
    device.osName = os.name
    if (os.version) device.osVersion = os.version.slice(0, 32)
  }

  const browser = browserFromBrands(nav.userAgentData?.brands) ?? browserFromUserAgent(ua)
  if (browser) device.model = browser.slice(0, 64)

  if (nav.language) device.locale = nav.language.slice(0, 35)

  // The region the browser is set to. A good guess at where someone is, and
  // free — unlike asking for location. An app that knows better passes
  // `country` to submit() and that wins.
  const region = regionOf(device.locale)
  if (region) device.country = region

  return device
}
