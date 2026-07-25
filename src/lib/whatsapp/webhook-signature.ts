import crypto from 'node:crypto'

/**
 * Verify the HMAC-SHA256 signature Meta attaches to webhook POSTs.
 *
 * Meta signs the raw request body with your App Secret and sends the
 * result in the `x-hub-signature-256: sha256=<hex>` header. Without
 * verification, anyone who knows our webhook URL can POST fabricated
 * status updates and drift broadcast counts arbitrarily.
 *
 * Reference:
 *   https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verify-payloads
 *
 * Contract:
 *   At least one of `META_APP_SECRET` or `MESSENGER_META_APP_SECRET` is
 *   required. If both are missing we fail closed. Messenger may use a
 *   different Meta app than WhatsApp on the same CRM — try both secrets.
 */
export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secrets = [
    process.env.META_APP_SECRET,
    process.env.MESSENGER_META_APP_SECRET,
  ]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s))

  if (secrets.length === 0) {
    console.error(
      '[webhook] META_APP_SECRET / MESSENGER_META_APP_SECRET is not set — rejecting request. ' +
        'Configure the env var (Meta → App Settings → Basic → App Secret) ' +
        'to enable signature verification.',
    )
    return false
  }

  if (!signatureHeader) return false
  if (!signatureHeader.startsWith('sha256=')) return false

  const a = Buffer.from(signatureHeader)
  for (const secret of secrets) {
    const expected =
      'sha256=' +
      crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    const b = Buffer.from(expected)
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return true
    }
  }
  return false
}
