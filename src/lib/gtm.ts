/**
 * Google Tag Manager helpers — validation + default container for this deploy.
 * Container IDs are public by nature (they ship in page HTML).
 */

export const GTM_ID_PATTERN = /^GTM-[A-Z0-9]+$/i;

/** Known production container for Dawat Lead CRM (crm2.dawatit.com). */
export const DEFAULT_GTM_CONTAINER_ID = 'GTM-5M8CLVW9';

export function isValidGtmContainerId(value: string): boolean {
  return GTM_ID_PATTERN.test(value.trim());
}

export function normalizeGtmContainerId(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Prefer `NEXT_PUBLIC_GTM_ID`, then `GTM_CONTAINER_ID`, then the deploy default.
 */
export function resolveDefaultGtmContainerId(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_GTM_ID?.trim() ||
    process.env.GTM_CONTAINER_ID?.trim() ||
    '';
  if (fromEnv && isValidGtmContainerId(fromEnv)) {
    return normalizeGtmContainerId(fromEnv);
  }
  return DEFAULT_GTM_CONTAINER_ID;
}

/** Site-wide env container (root layout). Empty string when unset/invalid. */
export function resolveEnvGtmContainerId(): string | null {
  const raw = process.env.NEXT_PUBLIC_GTM_ID?.trim() || '';
  if (!raw || !isValidGtmContainerId(raw)) return null;
  return normalizeGtmContainerId(raw);
}
