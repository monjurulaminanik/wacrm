/**
 * App locales — Bangla is the product default; English is opt-in.
 * Persisted in the `wacrm.locale` cookie (readable on the server).
 */

export const LOCALES = ["bn", "en"] as const;
export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "bn";
export const LOCALE_COOKIE = "wacrm.locale";

export function isAppLocale(value: unknown): value is AppLocale {
  return (
    typeof value === "string" &&
    (LOCALES as ReadonlyArray<string>).includes(value)
  );
}

/** Deep-merge message dictionaries (bn overlays en for missing keys). */
export function mergeMessages(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const prev = out[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      prev &&
      typeof prev === "object" &&
      !Array.isArray(prev)
    ) {
      out[key] = mergeMessages(
        prev as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}
