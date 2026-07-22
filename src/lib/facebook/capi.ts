/**
 * Meta Conversions API (CAPI) for Business Messaging + Pixel.
 *
 * Primary path: action_source = business_messaging with messaging_channel
 * whatsapp | messenger (Meta's recommended path for CTWA / Click-to-Messenger).
 *
 * Fail-open: callers should catch / use fireCapiForInbound which never throws.
 */

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/whatsapp/encryption";

const META_API_VERSION = "v21.0";
const PARTNER_AGENT = "DawatLeadCRM";

export type MessagingChannel = "whatsapp" | "messenger";

/** Meta business-messaging event names (not classic Pixel Lead/Contact). */
export type CapiMessagingEventName =
  | "LeadSubmitted"
  | "QualifiedLead"
  | "Purchase"
  | "ViewContent";

export interface CapiUserIdentifiers {
  contactId: string;
  phone?: string | null;
  email?: string | null;
  /** WhatsApp CTWA click id from message.referral.ctwa_clid */
  ctwaClid?: string | null;
  /** Messenger page-scoped user id */
  messengerPsid?: string | null;
  pageId?: string | null;
  wabaId?: string | null;
  fbp?: string | null;
  fbc?: string | null;
}

export interface SendCapiEventInput {
  pixelId: string;
  accessToken: string;
  testEventCode?: string | null;
  eventName: CapiMessagingEventName;
  eventId: string;
  eventTime?: number;
  channel: MessagingChannel;
  user: CapiUserIdentifiers;
  customData?: Record<string, unknown>;
}

export interface CapiSendResult {
  ok: boolean;
  eventsReceived?: number;
  error?: string;
  raw?: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null;
function adminDb() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _admin;
}

/** Normalize then SHA-256 hex (Meta CAPI requirement for em/ph). */
export function hashForCapi(value: string): string {
  const normalized = value.trim().toLowerCase();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/** Digits-only phone, with leading country code when possible. */
export function normalizePhoneForCapi(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits;
}

function buildUserData(
  channel: MessagingChannel,
  user: CapiUserIdentifiers,
): Record<string, unknown> {
  const userData: Record<string, unknown> = {
    external_id: hashForCapi(user.contactId),
  };

  if (user.phone) {
    const ph = normalizePhoneForCapi(user.phone);
    if (ph) userData.ph = [hashForCapi(ph)];
  }
  if (user.email?.includes("@")) {
    userData.em = [hashForCapi(user.email)];
  }
  if (user.fbp) userData.fbp = user.fbp;
  if (user.fbc) userData.fbc = user.fbc;

  if (channel === "whatsapp") {
    if (user.wabaId) {
      userData.whatsapp_business_account_id = user.wabaId;
    }
    if (user.ctwaClid) {
      userData.ctwa_clid = user.ctwaClid;
    }
  }

  if (channel === "messenger") {
    if (user.pageId) userData.page_id = user.pageId;
    if (user.messengerPsid) {
      userData.page_scoped_user_id = user.messengerPsid;
    }
  }

  return userData;
}

/**
 * POST one event to Meta Graph `/{pixel_or_dataset_id}/events`.
 */
export async function sendCapiEvent(
  input: SendCapiEventInput,
): Promise<CapiSendResult> {
  const eventTime = input.eventTime ?? Math.floor(Date.now() / 1000);

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: input.eventName,
        event_time: eventTime,
        event_id: input.eventId,
        action_source: "business_messaging",
        messaging_channel: input.channel,
        user_data: buildUserData(input.channel, input.user),
        ...(input.customData ? { custom_data: input.customData } : {}),
      },
    ],
    partner_agent: PARTNER_AGENT,
  };

  if (input.testEventCode?.trim()) {
    payload.test_event_code = input.testEventCode.trim();
  }

  const url = `https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(input.pixelId)}/events?access_token=${encodeURIComponent(input.accessToken)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message =
        (raw as { error?: { message?: string } })?.error?.message ||
        `Meta CAPI HTTP ${res.status}`;
      return { ok: false, error: message, raw };
    }
    const eventsReceived = (raw as { events_received?: number })?.events_received;
    return { ok: true, eventsReceived, raw };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "CAPI network error",
    };
  }
}

interface LoadedCapiConfig {
  pixelId: string;
  accessToken: string;
  testEventCode: string | null;
  sendLeadOnFirstMessage: boolean;
  sendQualifiedLeadOnNewContact: boolean;
  wabaId: string | null;
  pageId: string | null;
  configId: string;
}

async function loadEnabledConfig(
  accountId: string,
): Promise<LoadedCapiConfig | null> {
  const { data, error } = await adminDb()
    .from("facebook_capi_config")
    .select(
      "id, pixel_id, access_token, test_event_code, enabled, send_lead_on_first_message, send_qualified_lead_on_new_contact, waba_id, page_id",
    )
    .eq("account_id", accountId)
    .maybeSingle();

  if (error || !data || !data.enabled) return null;

  let accessToken: string;
  try {
    accessToken = decrypt(data.access_token);
  } catch (err) {
    console.error("[capi] decrypt failed", err);
    return null;
  }

  return {
    configId: data.id,
    pixelId: data.pixel_id,
    accessToken,
    testEventCode: data.test_event_code,
    sendLeadOnFirstMessage: data.send_lead_on_first_message !== false,
    sendQualifiedLeadOnNewContact:
      data.send_qualified_lead_on_new_contact !== false,
    wabaId: data.waba_id,
    pageId: data.page_id,
  };
}

async function resolveChannelIds(
  accountId: string,
  channel: MessagingChannel,
  cfg: LoadedCapiConfig,
): Promise<{ wabaId: string | null; pageId: string | null }> {
  let wabaId = cfg.wabaId;
  let pageId = cfg.pageId;

  if (channel === "whatsapp" && !wabaId) {
    const { data } = await adminDb()
      .from("whatsapp_config")
      .select("waba_id")
      .eq("account_id", accountId)
      .maybeSingle();
    wabaId = data?.waba_id ?? null;
  }

  if (channel === "messenger" && !pageId) {
    const { data } = await adminDb()
      .from("messenger_config")
      .select("page_id")
      .eq("account_id", accountId)
      .maybeSingle();
    pageId = data?.page_id ?? null;
  }

  return { wabaId, pageId };
}

async function recordEngagement(params: {
  accountId: string;
  contactId: string;
  channel: MessagingChannel;
}): Promise<void> {
  const db = adminDb();
  const now = new Date().toISOString();
  const { data: existing } = await db
    .from("facebook_capi_engagements")
    .select("id, inbound_count")
    .eq("account_id", params.accountId)
    .eq("contact_id", params.contactId)
    .eq("channel", params.channel)
    .maybeSingle();

  if (existing) {
    const { error } = await db
      .from("facebook_capi_engagements")
      .update({
        last_engaged_at: now,
        inbound_count: (existing.inbound_count || 0) + 1,
      })
      .eq("id", existing.id);
    if (error) console.error("[capi] engagement update", error);
  } else {
    const { error } = await db.from("facebook_capi_engagements").insert({
      account_id: params.accountId,
      contact_id: params.contactId,
      channel: params.channel,
      first_engaged_at: now,
      last_engaged_at: now,
      inbound_count: 1,
    });
    // Unique race — ignore
    if (error && (error as { code?: string }).code !== "23505") {
      console.error("[capi] engagement insert", error);
    }
  }
}

async function markConfigResult(
  configId: string,
  result: CapiSendResult,
): Promise<void> {
  const patch: Record<string, unknown> = {
    last_error: result.ok ? null : (result.error || "unknown").slice(0, 500),
    updated_at: new Date().toISOString(),
  };
  if (result.ok) {
    patch.last_event_at = new Date().toISOString();
  }
  await adminDb().from("facebook_capi_config").update(patch).eq("id", configId);
}

export interface FireCapiInboundParams {
  accountId: string;
  contactId: string;
  channel: MessagingChannel;
  /** Meta message id — used for event_id dedupe */
  messageId: string;
  phone?: string | null;
  email?: string | null;
  ctwaClid?: string | null;
  messengerPsid?: string | null;
  /** True when this webhook created the contact row */
  wasCreated: boolean;
  /** True when this is the contact's first inbound customer message */
  isFirstInbound: boolean;
  eventTime?: number;
}

/**
 * Fire-and-forget safe entry from WhatsApp / Messenger webhooks.
 * Never throws. Skips when CAPI is disabled / misconfigured.
 */
export async function fireCapiForInbound(
  params: FireCapiInboundParams,
): Promise<void> {
  try {
    await recordEngagement({
      accountId: params.accountId,
      contactId: params.contactId,
      channel: params.channel,
    }).catch((err) => console.error("[capi] engagement record failed", err));

    const cfg = await loadEnabledConfig(params.accountId);
    if (!cfg) return;

    const { wabaId, pageId } = await resolveChannelIds(
      params.accountId,
      params.channel,
      cfg,
    );

    const user: CapiUserIdentifiers = {
      contactId: params.contactId,
      phone: params.phone,
      email: params.email,
      ctwaClid: params.ctwaClid,
      messengerPsid: params.messengerPsid,
      pageId,
      wabaId,
    };

    const eventTime = params.eventTime ?? Math.floor(Date.now() / 1000);
    const results: CapiSendResult[] = [];

    // New contact → QualifiedLead (Lead tag applied in CRM)
    if (params.wasCreated && cfg.sendQualifiedLeadOnNewContact) {
      const r = await sendCapiEvent({
        pixelId: cfg.pixelId,
        accessToken: cfg.accessToken,
        testEventCode: cfg.testEventCode,
        eventName: "QualifiedLead",
        eventId: `ql_${params.contactId}`,
        eventTime,
        channel: params.channel,
        user,
      });
      results.push(r);
      if (!r.ok) console.error("[capi] QualifiedLead failed", r.error);
    }

    // First inbound message → LeadSubmitted (Meta messaging standard)
    if (params.isFirstInbound && cfg.sendLeadOnFirstMessage) {
      const r = await sendCapiEvent({
        pixelId: cfg.pixelId,
        accessToken: cfg.accessToken,
        testEventCode: cfg.testEventCode,
        eventName: "LeadSubmitted",
        // Dedup by message id so Meta retries don't double-count
        eventId: `lead_${params.messageId}`,
        eventTime,
        channel: params.channel,
        user,
      });
      results.push(r);
      if (!r.ok) console.error("[capi] LeadSubmitted failed", r.error);
    }

    // Subsequent messages: still useful as ViewContent for engagement signal
    // when neither first-inbound nor new-contact fired.
    if (
      !params.isFirstInbound &&
      !params.wasCreated &&
      results.length === 0
    ) {
      // No-op for routine chatter — avoid flooding Meta with every message.
      // Engagement row above is enough for Custom Audience sync later.
    }

    const last = results[results.length - 1];
    if (last) {
      await markConfigResult(cfg.configId, last).catch(() => {});
    }
  } catch (err) {
    console.error("[capi] fireCapiForInbound unexpected", err);
  }
}
