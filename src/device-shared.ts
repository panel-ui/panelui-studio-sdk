/** `en-US` → US, `zh-Hans-CN` → CN, `fr` → undefined. */
export function regionOf(locale: string | undefined): string | undefined {
  if (!locale) return undefined
  for (const part of locale.replace(/_/g, "-").split("-").slice(1)) {
    if (/^[A-Za-z]{2}$/.test(part)) return part.toUpperCase()
  }
  return undefined
}
