import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/whatsapp/encryption";
import {
  CAPI_MESSENGER_PSID_HINT_BN,
  enrichCapiErrorForUi,
  formatMetaCapiError,
  isValidMessengerPsid,
  sanitizeTestEventCode,
  sendCapiConnectivityTest,
  sendCapiEvent,
  type MessagingChannel,
} from "@/lib/facebook/capi";

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data?.account_id) return null;
  return data.account_id as string;
}

const MASK = "••••••••••••••••";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accountId = await resolveAccountId(supabase, user.id);
    if (!accountId) {
      return NextResponse.json({ configured: false }, { status: 200 });
    }

    const { data: config } = await supabase
      .from("facebook_capi_config")
      .select(
        "pixel_id, access_token, test_event_code, enabled, send_lead_on_first_message, send_qualified_lead_on_new_contact, waba_id, page_id, last_error, last_event_at",
      )
      .eq("account_id", accountId)
      .maybeSingle();

    if (!config) {
      return NextResponse.json({ configured: false }, { status: 200 });
    }

    return NextResponse.json({
      configured: true,
      enabled: config.enabled,
      pixel_id: config.pixel_id,
      has_token: Boolean(config.access_token),
      token_masked: config.access_token ? MASK : "",
      test_event_code: config.test_event_code || "",
      send_lead_on_first_message: config.send_lead_on_first_message,
      send_qualified_lead_on_new_contact:
        config.send_qualified_lead_on_new_contact,
      waba_id: config.waba_id || "",
      page_id: config.page_id || "",
      last_error: config.last_error,
      last_event_at: config.last_event_at,
    });
  } catch (err) {
    console.error("[facebook/capi/config GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accountId = await resolveAccountId(supabase, user.id);
    if (!accountId) {
      return NextResponse.json(
        { error: "Your profile is not linked to an account." },
        { status: 403 },
      );
    }

    const body = await request.json();
    const {
      pixel_id,
      access_token,
      test_event_code,
      enabled,
      send_lead_on_first_message,
      send_qualified_lead_on_new_contact,
      waba_id,
      page_id,
      clear_token,
    } = body as {
      pixel_id?: string;
      access_token?: string;
      test_event_code?: string | null;
      enabled?: boolean;
      send_lead_on_first_message?: boolean;
      send_qualified_lead_on_new_contact?: boolean;
      waba_id?: string | null;
      page_id?: string | null;
      clear_token?: boolean;
    };

    const pixelId = typeof pixel_id === "string" ? pixel_id.trim() : "";
    if (!pixelId) {
      return NextResponse.json(
        { error: "Pixel / Dataset ID is required" },
        { status: 400 },
      );
    }

    const { data: existing } = await supabase
      .from("facebook_capi_config")
      .select("id, access_token")
      .eq("account_id", accountId)
      .maybeSingle();

    let encryptedAccess: string | undefined;
    const tokenIncoming =
      typeof access_token === "string" ? access_token.trim() : "";
    const tokenIsNew =
      tokenIncoming &&
      tokenIncoming !== MASK &&
      !tokenIncoming.includes("•");

    if (tokenIsNew) {
      try {
        encryptedAccess = encrypt(tokenIncoming);
      } catch {
        return NextResponse.json(
          {
            error:
              "Failed to encrypt token. Check ENCRYPTION_KEY is a valid 64-char hex string.",
          },
          { status: 500 },
        );
      }
    } else if (!existing?.access_token || clear_token) {
      return NextResponse.json(
        { error: "Conversion API access token is required" },
        { status: 400 },
      );
    }

    const row: Record<string, unknown> = {
      user_id: user.id,
      account_id: accountId,
      pixel_id: pixelId,
      // Drop UI placeholders like TEST12345 — never persist fakes.
      test_event_code: sanitizeTestEventCode(test_event_code),
      enabled: Boolean(enabled),
      send_lead_on_first_message:
        send_lead_on_first_message !== undefined
          ? Boolean(send_lead_on_first_message)
          : true,
      send_qualified_lead_on_new_contact:
        send_qualified_lead_on_new_contact !== undefined
          ? Boolean(send_qualified_lead_on_new_contact)
          : true,
      waba_id: waba_id?.trim() || null,
      page_id: page_id?.trim() || null,
      updated_at: new Date().toISOString(),
      last_error: null,
    };
    if (encryptedAccess) {
      row.access_token = encryptedAccess;
    }

    if (existing) {
      const { error } = await supabase
        .from("facebook_capi_config")
        .update(row)
        .eq("account_id", accountId);
      if (error) {
        console.error("[facebook/capi/config] update", error);
        return NextResponse.json(
          { error: "Failed to update configuration" },
          { status: 500 },
        );
      }
    } else {
      if (!encryptedAccess) {
        return NextResponse.json(
          { error: "Conversion API access token is required" },
          { status: 400 },
        );
      }
      row.access_token = encryptedAccess;
      const { error } = await supabase.from("facebook_capi_config").insert(row);
      if (error) {
        console.error("[facebook/capi/config] insert", error);
        return NextResponse.json(
          { error: "Failed to save configuration" },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[facebook/capi/config POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accountId = await resolveAccountId(supabase, user.id);
    if (!accountId) {
      return NextResponse.json({ error: "No account" }, { status: 403 });
    }

    const { error } = await supabase
      .from("facebook_capi_config")
      .delete()
      .eq("account_id", accountId);

    if (error) {
      return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[facebook/capi/config DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * PUT — send a Test event to Meta Events Manager (uses saved config).
 * Picks Messenger when Page ID is available, else WhatsApp when WABA is set.
 * Does not require CAPI "enabled" — Save and Test stay independent.
 */
export async function PUT() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accountId = await resolveAccountId(supabase, user.id);
    if (!accountId) {
      return NextResponse.json({ error: "No account" }, { status: 403 });
    }

    const { data: config } = await supabase
      .from("facebook_capi_config")
      .select("pixel_id, access_token, test_event_code, page_id, waba_id")
      .eq("account_id", accountId)
      .maybeSingle();

    if (!config?.access_token || !config.pixel_id) {
      return NextResponse.json(
        { error: "Save Pixel ID and access token first" },
        { status: 400 },
      );
    }

    let token: string;
    try {
      token = decrypt(config.access_token);
    } catch {
      return NextResponse.json(
        { error: "Stored token cannot be decrypted" },
        { status: 500 },
      );
    }

    let wabaId = (config.waba_id as string | null)?.trim() || null;
    let pageId = (config.page_id as string | null)?.trim() || null;

    if (!wabaId) {
      const { data: wa } = await supabase
        .from("whatsapp_config")
        .select("waba_id")
        .eq("account_id", accountId)
        .maybeSingle();
      wabaId = wa?.waba_id?.trim() || null;
    }
    if (!pageId) {
      const { data: ms } = await supabase
        .from("messenger_config")
        .select("page_id")
        .eq("account_id", accountId)
        .maybeSingle();
      pageId = ms?.page_id?.trim() || null;
    }

    // Prefer Messenger when Page ID is present (common for CTM / RingGo Page ads);
    // otherwise WhatsApp when WABA is available.
    let channel: MessagingChannel | null = null;
    if (pageId) channel = "messenger";
    else if (wabaId) channel = "whatsapp";

    if (!channel) {
      const msg =
        "Fill Page ID (Messenger) or WABA ID (WhatsApp) before Send test — Meta rejects business_messaging events without the channel id.";
      await supabase
        .from("facebook_capi_config")
        .update({
          last_error: msg.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("account_id", accountId);
      return NextResponse.json({ ok: false, error: msg }, { status: 200 });
    }

    const eventId = `test_${Date.now()}`;
    const testCode = sanitizeTestEventCode(config.test_event_code);

    // Messenger business_messaging requires a real Page-scoped user id.
    // Look up a recent contact PSID; never send a synthetic/fake PSID.
    let realPsid: string | null = null;
    let realContactId: string | null = null;
    if (channel === "messenger") {
      const { data: contact } = await supabase
        .from("contacts")
        .select("id, messenger_psid")
        .eq("account_id", accountId)
        .not("messenger_psid", "is", null)
        .neq("messenger_psid", "")
        .order("updated_at", { ascending: false })
        .limit(20);

      const match = (contact || []).find((c) =>
        isValidMessengerPsid(c.messenger_psid as string),
      );
      if (match) {
        realPsid = String(match.messenger_psid).trim();
        realContactId = match.id as string;
      }
    }

    let result;
    let mode: "messenger" | "whatsapp" | "connectivity" = channel;

    if (channel === "messenger" && !realPsid) {
      // No real conversation yet — connectivity check without PSID so Save/Test works.
      mode = "connectivity";
      result = await sendCapiConnectivityTest({
        pixelId: config.pixel_id,
        accessToken: token,
        testEventCode: testCode,
        eventId,
        contactId: `test-${accountId}`,
        phone: "8801700000000",
      });
    } else {
      result = await sendCapiEvent({
        pixelId: config.pixel_id,
        accessToken: token,
        testEventCode: testCode,
        eventName: "LeadSubmitted",
        eventId,
        channel,
        user: {
          contactId: realContactId || `test-${accountId}`,
          phone: channel === "whatsapp" ? "8801700000000" : null,
          wabaId: channel === "whatsapp" ? wabaId : null,
          pageId: channel === "messenger" ? pageId : null,
          messengerPsid: channel === "messenger" ? realPsid : null,
        },
      });
    }

    const errorText = result.ok
      ? null
      : enrichCapiErrorForUi(
          result.error || formatMetaCapiError(result.raw, "test failed"),
        ).slice(0, 500);

    await supabase
      .from("facebook_capi_config")
      .update({
        last_event_at: result.ok ? new Date().toISOString() : undefined,
        last_error: errorText,
        updated_at: new Date().toISOString(),
      })
      .eq("account_id", accountId);

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: errorText,
          channel,
          mode,
          hint_bn:
            channel === "messenger" ? CAPI_MESSENGER_PSID_HINT_BN : undefined,
          raw: result.raw,
        },
        { status: 200 },
      );
    }

    return NextResponse.json({
      ok: true,
      events_received: result.eventsReceived,
      event_id: eventId,
      channel,
      mode,
      used_real_psid: Boolean(realPsid),
      hint_bn:
        mode === "connectivity" ? CAPI_MESSENGER_PSID_HINT_BN : undefined,
    });
  } catch (err) {
    console.error("[facebook/capi/config PUT]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
