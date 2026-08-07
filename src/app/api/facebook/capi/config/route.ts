import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { encrypt, decrypt } from "@/lib/whatsapp/encryption";
import {
  CAPI_MESSENGER_PSID_HINT_BN,
  CAPI_PAGE_DATASET_HINT_BN,
  enrichCapiErrorForUi,
  formatMetaCapiError,
  isValidMessengerPsid,
  sanitizeTestEventCode,
  sendCapiConnectivityTest,
  sendCapiEventWithLeadFallback,
  type MessagingChannel,
} from "@/lib/facebook/capi";

// Config writes are account-scoped. The caller is checked with requireRole
// first, then the service-role client is used for the actual row write. This
// avoids a confusing RLS failure when the account context is valid but the
// browser session's claims/schema cache are stale.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}

const MASK = "••••••••••••••••";

type DbError = { code?: string; message?: string; details?: string };

function isMissingSchemaError(error: DbError | null | undefined): boolean {
  const message = error?.message || "";
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    /column .* does not exist|relation .* does not exist|schema cache/i.test(
      message,
    )
  );
}

function configDbError(error: DbError, action: string): string {
  if (isMissingSchemaError(error)) {
    return `Facebook CAPI database schema is incomplete. Apply supabase/migrations/039_facebook_capi.sql through 043_facebook_capi_view_content.sql, then retry ${action}.`;
  }
  if (error.code === "42501") {
    return "You need an account owner/admin role to change Facebook CAPI settings.";
  }
  return error.message
    ? `Failed to ${action}: ${error.message}`
    : `Failed to ${action}.`;
}

/**
 * 043 added ViewContent and 041 added page_associated. Keep older installs
 * usable while their migrations are being applied: read the core 039 shape
 * and use safe defaults for the newer flags.
 */
async function readConfig(db: ReturnType<typeof supabaseAdmin>, accountId: string) {
  const full = await db
    .from("facebook_capi_config")
    .select(
      "id, pixel_id, access_token, test_event_code, enabled, send_lead_on_first_message, send_qualified_lead_on_new_contact, send_view_content_on_every_message, waba_id, page_id, page_associated, last_error, last_event_at",
    )
    .eq("account_id", accountId)
    .maybeSingle();

  if (!full.error || !isMissingSchemaError(full.error)) return full;

  return db
    .from("facebook_capi_config")
    .select(
      "id, pixel_id, access_token, test_event_code, enabled, send_lead_on_first_message, send_qualified_lead_on_new_contact, waba_id, page_id, last_error, last_event_at",
    )
    .eq("account_id", accountId)
    .maybeSingle();
}

async function writeConfig(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  row: Record<string, unknown>,
  existing: boolean,
) {
  const first = existing
    ? await db.from("facebook_capi_config").update(row).eq("account_id", accountId)
    : await db.from("facebook_capi_config").insert(row);

  // A partially migrated install can still save the core credentials and
  // flags. Retry without the newer optional column instead of losing the
  // entire Pixel/token save.
  if (first.error && isMissingSchemaError(first.error) && "send_view_content_on_every_message" in row) {
    const legacyRow = { ...row };
    delete legacyRow.send_view_content_on_every_message;
    return existing
      ? db.from("facebook_capi_config").update(legacyRow).eq("account_id", accountId)
      : db.from("facebook_capi_config").insert(legacyRow);
  }
  return first;
}

async function updateConfig(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  patch: Record<string, unknown>,
) {
  const first = await db
    .from("facebook_capi_config")
    .update(patch)
    .eq("account_id", accountId);
  if (first.error && isMissingSchemaError(first.error) && "page_associated" in patch) {
    const legacyPatch = { ...patch };
    delete legacyPatch.page_associated;
    return db
      .from("facebook_capi_config")
      .update(legacyPatch)
      .eq("account_id", accountId);
  }
  return first;
}

export async function GET() {
  try {
    const { accountId } = await requireRole("admin");
    const { data: config, error } = await readConfig(supabaseAdmin(), accountId);
    if (error) {
      console.error("[facebook/capi/config GET] database", error);
      return NextResponse.json(
        { error: configDbError(error, "load configuration") },
        { status: 500 },
      );
    }

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
      send_view_content_on_every_message:
        config.send_view_content_on_every_message !== false,
      waba_id: config.waba_id || "",
      page_id: config.page_id || "",
      page_associated: Boolean(config.page_associated),
      last_error: config.last_error,
      last_event_at: config.last_event_at,
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "UnauthorizedError" || err.name === "ForbiddenError")) {
      return toErrorResponse(err);
    }
    console.error("[facebook/capi/config GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole("admin");
    const db = supabaseAdmin();

    const body = await request.json();
    const {
      pixel_id,
      access_token,
      test_event_code,
      enabled,
      send_lead_on_first_message,
      send_qualified_lead_on_new_contact,
      send_view_content_on_every_message,
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
      send_view_content_on_every_message?: boolean;
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

    const { data: existing, error: existingError } = await db
      .from("facebook_capi_config")
      .select("id, access_token")
      .eq("account_id", accountId)
      .maybeSingle();
    if (existingError) {
      console.error("[facebook/capi/config] existing row", existingError);
      return NextResponse.json(
        { error: configDbError(existingError, "save configuration") },
        { status: 500 },
      );
    }

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
      user_id: userId,
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
      send_view_content_on_every_message:
        send_view_content_on_every_message !== undefined
          ? Boolean(send_view_content_on_every_message)
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
      const { error } = await writeConfig(db, accountId, row, true);
      if (error) {
        console.error("[facebook/capi/config] update", error);
        return NextResponse.json(
          { error: configDbError(error, "update configuration") },
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
      const { error } = await writeConfig(db, accountId, row, false);
      if (error) {
        console.error("[facebook/capi/config] insert", error);
        return NextResponse.json(
          { error: configDbError(error, "save configuration") },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.name === "UnauthorizedError" || err.name === "ForbiddenError")) {
      return toErrorResponse(err);
    }
    console.error("[facebook/capi/config POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const { accountId } = await requireRole("admin");

    const { error } = await supabaseAdmin()
      .from("facebook_capi_config")
      .delete()
      .eq("account_id", accountId);

    if (error) {
      return NextResponse.json(
        { error: configDbError(error, "delete configuration") },
        { status: 500 },
      );
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.name === "UnauthorizedError" || err.name === "ForbiddenError")) {
      return toErrorResponse(err);
    }
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
    const { accountId } = await requireRole("admin");
    const db = supabaseAdmin();

    const { data: config, error: configError } = await readConfig(db, accountId);
    if (configError) {
      return NextResponse.json(
        { error: configDbError(configError, "send test") },
        { status: 500 },
      );
    }

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
      const { data: wa } = await db
        .from("whatsapp_config")
        .select("waba_id")
        .eq("account_id", accountId)
        .maybeSingle();
      wabaId = wa?.waba_id?.trim() || null;
    }
    if (!pageId) {
      const { data: ms } = await db
        .from("messenger_config")
        .select("page_id")
        .eq("account_id", accountId)
        .maybeSingle();
      pageId = ms?.page_id?.trim() || null;
    }

    // Persist resolved Page ID so Settings UI stays in sync with Messenger.
    if (pageId && !(config.page_id as string | null)?.trim()) {
      await updateConfig(db, accountId, {
        page_id: pageId,
        updated_at: new Date().toISOString(),
      });
    }

    const pageAssociated = Boolean(config.page_associated);

    // Prefer Messenger when Page ID is present (common for CTM / RingGo Page ads);
    // otherwise WhatsApp when WABA is available.
    let channel: MessagingChannel | null = null;
    if (pageId) channel = "messenger";
    else if (wabaId) channel = "whatsapp";

    if (!channel) {
      const msg =
        "Fill Page ID (Messenger) or WABA ID (WhatsApp) before Send test — Meta rejects business_messaging events without the channel id.";
      await updateConfig(db, accountId, {
          last_error: msg.slice(0, 500),
          updated_at: new Date().toISOString(),
        });
      return NextResponse.json({ ok: false, error: msg }, { status: 200 });
    }

    const eventId = `test_${Date.now()}`;
    const testCode = sanitizeTestEventCode(config.test_event_code);

    // Messenger business_messaging requires a real Page-scoped user id.
    // Look up a recent contact PSID; never send a synthetic/fake PSID.
    let realPsid: string | null = null;
    let realContactId: string | null = null;
    if (channel === "messenger" && pageAssociated) {
      const { data: contact } = await db
        .from("contacts")
        .select("id, messenger_psid")
        .eq("account_id", accountId)
        .not("messenger_psid", "is", null)
        .neq("messenger_psid", "")
        .order("updated_at", { ascending: false })
        .limit(20);

      const match = (contact || []).find(
        (c: { id: string; messenger_psid: string | null }) =>
          isValidMessengerPsid(c.messenger_psid),
      );
      if (match) {
        realPsid = String(match.messenger_psid).trim();
        realContactId = match.id as string;
      }
    }

    let result;
    let mode:
      | "messenger"
      | "whatsapp"
      | "connectivity"
      | "lead_fallback"
      | "lead_preferred" = channel;

    // Until Page↔Dataset is linked for messaging, default test to classic Lead
    // so the UI shows success instead of the CTM association error.
    if (!pageAssociated) {
      mode = "lead_preferred";
      result = await sendCapiConnectivityTest({
        pixelId: config.pixel_id,
        accessToken: token,
        testEventCode: testCode,
        eventId,
        contactId: realContactId || `test-${accountId}`,
        phone: "8801700000000",
      });
      if (result.ok) {
        result = {
          ...result,
          usedLeadFallback: true,
          messagingNote: CAPI_PAGE_DATASET_HINT_BN,
        };
      }
    } else if (channel === "messenger" && !realPsid) {
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
      result = await sendCapiEventWithLeadFallback({
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
      if (result.usedLeadFallback) mode = "lead_fallback";
    }

    // Soft messaging notes must not become last_error when Lead succeeded.
    const errorText = result.ok
      ? null
      : enrichCapiErrorForUi(
          result.error || formatMetaCapiError(result.raw, "test failed"),
        ).slice(0, 500);

    const patch: Record<string, unknown> = {
      last_error: errorText,
      updated_at: new Date().toISOString(),
    };
    if (result.ok) {
      patch.last_event_at = new Date().toISOString();
      if (result.mode === "business_messaging" && !result.usedLeadFallback) {
        patch.page_associated = true;
      }
    }

    await updateConfig(db, accountId, patch);

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: errorText,
          channel,
          mode,
          page_associated: pageAssociated,
          hint_bn: CAPI_PAGE_DATASET_HINT_BN,
          messaging_note: result.messagingNote,
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
      page_associated: Boolean(patch.page_associated) || pageAssociated,
      used_real_psid: Boolean(realPsid),
      used_lead_fallback: Boolean(result.usedLeadFallback),
      // Soft note — success toast primary; this is secondary description only.
      hint_bn:
        mode === "lead_preferred" ||
        mode === "lead_fallback" ||
        mode === "connectivity"
          ? mode === "connectivity"
            ? CAPI_MESSENGER_PSID_HINT_BN
            : CAPI_PAGE_DATASET_HINT_BN
          : undefined,
      messaging_note: result.messagingNote,
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "UnauthorizedError" || err.name === "ForbiddenError")) {
      return toErrorResponse(err);
    }
    console.error("[facebook/capi/config PUT]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
