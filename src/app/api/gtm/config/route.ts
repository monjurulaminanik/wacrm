import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  isValidGtmContainerId,
  normalizeGtmContainerId,
  resolveDefaultGtmContainerId,
} from '@/lib/gtm';

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data?.account_id) return null;
  return data.account_id as string;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const defaultContainerId = resolveDefaultGtmContainerId();
    const accountId = await resolveAccountId(supabase, user.id);
    if (!accountId) {
      return NextResponse.json({
        configured: false,
        connected: false,
        container_id: '',
        enabled: false,
        default_container_id: defaultContainerId,
      });
    }

    const { data: config } = await supabase
      .from('gtm_config')
      .select('container_id, enabled')
      .eq('account_id', accountId)
      .maybeSingle();

    if (!config?.container_id) {
      return NextResponse.json({
        configured: false,
        connected: false,
        container_id: '',
        enabled: false,
        default_container_id: defaultContainerId,
      });
    }

    const connected =
      Boolean(config.enabled) && isValidGtmContainerId(config.container_id);

    return NextResponse.json({
      configured: true,
      connected,
      container_id: config.container_id,
      enabled: Boolean(config.enabled),
      default_container_id: defaultContainerId,
    });
  } catch (err) {
    console.error('[gtm/config GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accountId = await resolveAccountId(supabase, user.id);
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const rawId =
      typeof body.container_id === 'string' ? body.container_id : '';
    const containerId = normalizeGtmContainerId(rawId);

    if (!containerId || !isValidGtmContainerId(containerId)) {
      return NextResponse.json(
        {
          error:
            'Invalid GTM Container ID. Expected format: GTM-XXXXXXX',
        },
        { status: 400 },
      );
    }

    const enabled =
      body.enabled === undefined ? true : Boolean(body.enabled);

    const { data: existing } = await supabase
      .from('gtm_config')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle();

    if (existing?.id) {
      const { error } = await supabase
        .from('gtm_config')
        .update({
          container_id: containerId,
          enabled,
          user_id: user.id,
        })
        .eq('id', existing.id);
      if (error) {
        console.error('[gtm/config] update', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else {
      const { error } = await supabase.from('gtm_config').insert({
        user_id: user.id,
        account_id: accountId,
        container_id: containerId,
        enabled,
      });
      if (error) {
        console.error('[gtm/config] insert', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      ok: true,
      configured: true,
      connected: enabled,
      container_id: containerId,
      enabled,
    });
  } catch (err) {
    console.error('[gtm/config POST]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accountId = await resolveAccountId(supabase, user.id);
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      );
    }

    const { error } = await supabase
      .from('gtm_config')
      .delete()
      .eq('account_id', accountId);
    if (error) {
      console.error('[gtm/config DELETE]', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[gtm/config DELETE]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
