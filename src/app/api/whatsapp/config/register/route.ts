import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/whatsapp/encryption'
import { registerPhoneNumber } from '@/lib/whatsapp/meta-api'

/**
 * POST /api/whatsapp/config/register
 *
 * Completes Meta Cloud API phone registration using the stored access
 * token + a 6-digit two-step PIN. Avoids forcing the user to re-paste
 * the permanent token just to set registered_at after a skipped save.
 *
 * Body: { pin: string }
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return NextResponse.json(
      { error: 'Your profile is not linked to an account.' },
      { status: 400 }
    )
  }

  let body: { pin?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const pin =
    typeof body.pin === 'string' ? body.pin.replace(/\D/g, '').slice(0, 6) : ''
  if (pin.length !== 6) {
    return NextResponse.json(
      {
        error:
          'Enter the 6-digit two-step verification PIN from Meta WhatsApp Manager.',
      },
      { status: 400 }
    )
  }

  const { data: config } = await supabase
    .from('whatsapp_config')
    .select('id, phone_number_id, access_token')
    .eq('account_id', accountId)
    .maybeSingle()

  if (!config?.phone_number_id || !config.access_token) {
    return NextResponse.json(
      { error: 'Save WhatsApp credentials first, then register with the PIN.' },
      { status: 400 }
    )
  }

  let accessToken: string
  try {
    accessToken = decrypt(config.access_token)
  } catch {
    return NextResponse.json(
      {
        error:
          'Stored access token cannot be decrypted. Reset configuration and save a new token.',
      },
      { status: 400 }
    )
  }

  try {
    const result = await registerPhoneNumber({
      phoneNumberId: config.phone_number_id,
      accessToken,
      pin,
    })

    const registeredAt = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('whatsapp_config')
      .update({
        registered_at: registeredAt,
        last_registration_error: null,
      })
      .eq('id', config.id)

    if (updateError) {
      console.error('Failed to persist registered_at:', updateError)
      return NextResponse.json(
        {
          error:
            'Meta accepted registration, but saving status failed. Click Verify with Meta.',
          registered: true,
          already_registered: result.alreadyRegistered,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      registered: true,
      already_registered: result.alreadyRegistered,
      registered_at: registeredAt,
      message: result.alreadyRegistered
        ? 'Number was already registered with Meta. Status updated.'
        : 'Number registered. Meta can now deliver webhook events.',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Meta API error'
    console.error('PIN-only /register failed:', message)

    await supabase
      .from('whatsapp_config')
      .update({ last_registration_error: message })
      .eq('id', config.id)

    return NextResponse.json(
      { error: message, registered: false },
      { status: 400 }
    )
  }
}
