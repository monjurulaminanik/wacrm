/**
 * Meta Conversions API (CAPI) for Business Messaging + Pixel.
 *
 * Primary path: action_source = business_messaging with messaging_channel
 * whatsapp | messenger (Meta's recommended path for CTWA / Click-to-Messenger).
 *
 * Fallback: when Page↔Dataset messaging link is blocked (Review needed /
 * mismatch / invalid PSID), send classic Pixel Lead with action_source=other
 * using hashed phone + external_id so ads still get a conversion signal.
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
  /**
   * Soft note when Lead path succeeded after messaging was skipped/rejected.
   * Must not be treated as a hard failure in the UI.
   */
  messagingNote?: string;
  raw?: unknown;
  /** Set when business_messaging failed and classic Lead (other) succeeded. */
  usedLeadFallback?: boolean;
  /** Which payload was accepted by Meta. */
  mode?: "business_messaging" | "lead_fallback";
}

/** Meta Graph error blob shape (partial). */
interface MetaGraphErrorBody {
  error?: {
    message?: string;
    error_user_title?: string;
    error_user_msg?: string;
    error_subcode?: number;
    code?: number;
  };
}

/**
 * Prefer Meta's human-readable error_user_msg over the opaque
 * "Invalid parameter" message field.
 */
export function formatMetaCapiError(raw: unknown, fallback?: string): string {
  const err = (raw as MetaGraphErrorBody | null)?.error;
  if (!err) return fallback || "Meta CAPI error";
  const userMsg = err.error_user_msg?.trim();
  const userTitle = err.error_user_title?.trim();
  const message = err.message?.trim();
  if (userMsg && userTitle && userTitle !== userMsg) {
    return `${userTitle}: ${userMsg}`;
  }
  if (userMsg) return userMsg;
  if (userTitle && message && userTitle !== message) {
    return `${userTitle}: ${message}`;
  }
  return userTitle || message || fallback || "Meta CAPI error";
}

/**
 * UI placeholder / obvious fakes must not be sent as test_event_code —
 * Meta rejects unknown codes with a generic Invalid parameter.
 */
export function sanitizeTestEventCode(
  code: string | null | undefined,
): string | null {
  const trimmed = code?.trim() || "";
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (
    upper === "TEST12345" ||
    upper === "TEST123" ||
    upper === "TEST" ||
    upper === "YOUR_TEST_EVENT_CODE"
  ) {
    return null;
  }
  return trimmed;
}

/**
 * Meta Messenger PSIDs are long numeric page-scoped ids.
 * Reject empty, phone-like, or obvious placeholders so we never
 * send fake page_scoped_user_id values (Meta rejects them).
 */
export function isValidMessengerPsid(
  psid: string | null | undefined,
): boolean {
  const s = psid?.trim() || "";
  if (!s) return false;
  // Digits only, typical PSID length (Meta page-scoped ids are long)
  if (!/^\d{10,}$/.test(s)) return false;
  // Common placeholders / synthetic test patterns
  if (/^0+$/.test(s) || s === "1234567890" || s.startsWith("000")) return false;
  return true;
}

/** Bangla hint when Messenger CAPI needs a real conversation PSID. */
export const CAPI_MESSENGER_PSID_HINT_BN =
  "টেস্টের জন্য আগে একটা Messenger মেসেজ থাকলে ভালো";

/** Bangla hint when Page↔Dataset messaging association is blocked. */
export const CAPI_PAGE_DATASET_HINT_BN =
  "Dataset-এ Page লিংক নেই — Events Manager → Dataset 184670… → Settings → Linked data / Connected assets → Facebook Page যোগ করুন (RingGo / 821488…). আপাতত CRM Lead (other) পাঠায়";

/**
 * True when Meta rejects business_messaging because Page/Dataset are not
 * linked for messaging, or PSID is invalid — safe to retry as classic Lead.
 */
export function isCapiMessagingAssociationError(
  error: string | null | undefined,
): boolean {
  if (!error) return false;
  return (
    /no page associated to dataset/i.test(error) ||
    /should have an associated page/i.test(error) ||
    /dataset.*associated page|associated page.*dataset/i.test(error) ||
    /mismatching page and dataset/i.test(error) ||
    /dataset must have permission to log events for the page/i.test(error) ||
    /page_id.*matched|matched.*page_id/i.test(error) ||
    /page_scoped_user_id|page-scoped user id|Invalid Page-scoped/i.test(
      error,
    ) ||
    /not (?:linked|associated|connected).*(?:page|dataset)|(?:page|dataset).*(?:not (?:linked|associated|connected))/i.test(
      error,
    )
  );
}

/**
 * Append a clear Bangla hint when Meta rejects an invalid PSID or page link.
 */
export function enrichCapiErrorForUi(error: string): string {
  if (
    /page_scoped_user_id|page-scoped user id|Invalid Page-scoped/i.test(error)
  ) {
    if (error.includes(CAPI_MESSENGER_PSID_HINT_BN)) return error;
    return `${error} — ${CAPI_MESSENGER_PSID_HINT_BN}`;
  }
  if (isCapiMessagingAssociationError(error)) {
    if (error.includes(CAPI_PAGE_DATASET_HINT_BN)) return error;
    return `${error} — ${CAPI_PAGE_DATASET_HINT_BN}`;
  }
  return error;
}

/** Map messaging event names to classic Pixel events for the Lead fallback. */
export function messagingEventToStandardLeadName(
  eventName: CapiMessagingEventName,
): string {
  switch (eventName) {
    case "Purchase":
      return "Purchase";
    case "ViewContent":
      return "ViewContent";
    case "LeadSubmitted":
    case "QualifiedLead":
    default:
      return "Lead";
  }
}

/** Channel-specific required user_data before calling Meta. */
export function validateCapiChannelUser(
  channel: MessagingChannel,
  user: CapiUserIdentifiers,
): string | null {
  if (channel === "whatsapp" && !user.wabaId?.trim()) {
    return "WhatsApp CAPI events require a WABA ID (fill WABA ID or connect WhatsApp settings).";
  }
  if (channel === "messenger") {
    if (!user.pageId?.trim()) {
      return "Messenger CAPI events require a Page ID (fill Page ID or connect Messenger settings).";
    }
    if (!isValidMessengerPsid(user.messengerPsid)) {
      return enrichCapiErrorForUi(
        "Messenger CAPI events require a valid page-scoped user id (PSID) from the conversation.",
      );
    }
  }
  return null;
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

async function postCapiPayload(
  pixelId: string,
  accessToken: string,
  payload: Record<string, unknown>,
): Promise<CapiSendResult> {
  const url = `https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: enrichCapiErrorForUi(
          formatMetaCapiError(raw, `Meta CAPI HTTP ${res.status}`),
        ),
        raw,
      };
    }
    const eventsReceived = (raw as { events_received?: number })
      ?.events_received;
    return { ok: true, eventsReceived, raw };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "CAPI network error",
    };
  }
}

/**
 * POST one business_messaging event to Meta Graph `/{pixel_or_dataset_id}/events`.
 * Does not fall back — use sendCapiEventWithLeadFallback for production sends.
 */
export async function sendCapiEvent(
  input: SendCapiEventInput,
): Promise<CapiSendResult> {
  const channelError = validateCapiChannelUser(input.channel, input.user);
  if (channelError) {
    return { ok: false, error: channelError, mode: "business_messaging" };
  }

  if (
    input.channel === "messenger" &&
    !isValidMessengerPsid(input.user.messengerPsid)
  ) {
    return {
      ok: false,
      error: enrichCapiErrorForUi(
        "Messenger CAPI events require a valid page-scoped user id (PSID) from a real conversation.",
      ),
      mode: "business_messaging",
    };
  }

  const eventTime = input.eventTime ?? Math.floor(Date.now() / 1000);
  const testEventCode = sanitizeTestEventCode(input.testEventCode);

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

  if (testEventCode) {
    payload.test_event_code = testEventCode;
  }

  const result = await postCapiPayload(
    input.pixelId,
    input.accessToken,
    payload,
  );
  return { ...result, mode: "business_messaging" };
}

export interface SendCapiLeadFallbackInput {
  pixelId: string;
  accessToken: string;
  testEventCode?: string | null;
  /** Original messaging event — mapped to classic Pixel name. */
  eventName: CapiMessagingEventName;
  eventId: string;
  eventTime?: number;
  contactId: string;
  phone?: string | null;
  email?: string | null;
  customData?: Record<string, unknown>;
  /** Meta action_source for non-messaging Lead. Prefer other while Page link is blocked. */
  actionSource?: "other" | "website";
}

/**
 * Classic Pixel Lead (or Purchase/ViewContent) without page_scoped_user_id.
 * Works without Page↔Dataset messaging association.
 */
export async function sendCapiLeadFallback(
  input: SendCapiLeadFallbackInput,
): Promise<CapiSendResult> {
  const eventTime = input.eventTime ?? Math.floor(Date.now() / 1000);
  const testEventCode = sanitizeTestEventCode(input.testEventCode);
  const standardName = messagingEventToStandardLeadName(input.eventName);

  const userData: Record<string, unknown> = {
    external_id: hashForCapi(input.contactId),
  };
  if (input.phone) {
    const ph = normalizePhoneForCapi(input.phone);
    if (ph) userData.ph = [hashForCapi(ph)];
  }
  if (input.email?.includes("@")) {
    userData.em = [hashForCapi(input.email)];
  }

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: standardName,
        event_time: eventTime,
        // Distinct id so a later successful business_messaging send does not collide
        event_id: `${input.eventId}_fb`,
        action_source: input.actionSource || "other",
        user_data: userData,
        ...(input.customData ? { custom_data: input.customData } : {}),
      },
    ],
    partner_agent: PARTNER_AGENT,
  };

  if (testEventCode) {
    payload.test_event_code = testEventCode;
  }

  const result = await postCapiPayload(
    input.pixelId,
    input.accessToken,
    payload,
  );
  return {
    ...result,
    mode: "lead_fallback",
    usedLeadFallback: result.ok,
  };
}

export type SendCapiEventWithFallbackInput = SendCapiEventInput & {
  /**
   * When true (Page not yet associated to dataset), skip business_messaging
   * and send classic Lead first — avoids scary CTM association errors in UI.
   */
  preferLeadFirst?: boolean;
};

/**
 * Try business_messaging first; on Page/Dataset mismatch or invalid PSID,
 * fall back to classic Lead (action_source=other) with hashed identifiers.
 * Always falls back when Messenger PSID is missing/invalid (pre-check).
 * When preferLeadFirst, skip messaging until Page↔Dataset is linked.
 */
export async function sendCapiEventWithLeadFallback(
  input: SendCapiEventWithFallbackInput,
): Promise<CapiSendResult> {
  if (input.preferLeadFirst) {
    const fallback = await sendCapiLeadFallback({
      pixelId: input.pixelId,
      accessToken: input.accessToken,
      testEventCode: input.testEventCode,
      eventName: input.eventName,
      eventId: input.eventId,
      eventTime: input.eventTime,
      contactId: input.user.contactId,
      phone: input.user.phone,
      email: input.user.email,
      customData: input.customData,
      actionSource: "other",
    });
    const note = enrichCapiErrorForUi(
      "Messaging path deferred until Page is linked to this dataset in Events Manager.",
    );
    if (fallback.ok) {
      return {
        ...fallback,
        usedLeadFallback: true,
        messagingNote: note,
      };
    }
    return {
      ok: false,
      error: fallback.error || "Lead event rejected by Meta",
      messagingNote: note,
      usedLeadFallback: true,
      mode: "lead_fallback",
      raw: fallback.raw,
    };
  }

  const canTryMessaging =
    input.channel !== "messenger" ||
    (Boolean(input.user.pageId?.trim()) &&
      isValidMessengerPsid(input.user.messengerPsid));

  let messagingError: string | undefined;

  if (canTryMessaging) {
    const primary = await sendCapiEvent(input);
    if (primary.ok) return primary;

    messagingError = primary.error;
    if (!isCapiMessagingAssociationError(primary.error)) {
      return primary;
    }

    console.warn(
      "[capi] business_messaging rejected — trying Lead fallback",
      primary.error,
    );
  } else {
    messagingError = enrichCapiErrorForUi(
      "Messenger CAPI skipped: contact has no valid page_scoped_user_id (PSID).",
    );
    console.warn(
      "[capi] skipping business_messaging (no valid PSID) — Lead fallback",
    );
  }

  const fallback = await sendCapiLeadFallback({
    pixelId: input.pixelId,
    accessToken: input.accessToken,
    testEventCode: input.testEventCode,
    eventName: input.eventName,
    eventId: input.eventId,
    eventTime: input.eventTime,
    contactId: input.user.contactId,
    phone: input.user.phone,
    email: input.user.email,
    customData: input.customData,
    actionSource: "other",
  });

  if (fallback.ok) {
    return {
      ...fallback,
      usedLeadFallback: true,
      // Soft note only — never surface as primary failure when Lead worked.
      messagingNote: messagingError
        ? enrichCapiErrorForUi(messagingError)
        : undefined,
    };
  }

  return {
    ok: false,
    // Lead failed too — keep Lead error primary; messaging note is secondary.
    error: enrichCapiErrorForUi(
      fallback.error ||
        messagingError ||
        "Meta rejected both business_messaging and Lead fallback",
    ),
    messagingNote: messagingError
      ? enrichCapiErrorForUi(messagingError)
      : undefined,
    usedLeadFallback: true,
    mode: "lead_fallback",
    raw: fallback.raw,
  };
}

export interface SendCapiConnectivityTestInput {
  pixelId: string;
  accessToken: string;
  testEventCode?: string | null;
  eventId: string;
  contactId: string;
  phone?: string | null;
  email?: string | null;
}

/**
 * Dataset connectivity check without business_messaging / PSID.
 * Uses action_source=other + classic Lead so Save/Test can succeed
 * when no real Messenger conversation exists yet.
 */
export async function sendCapiConnectivityTest(
  input: SendCapiConnectivityTestInput,
): Promise<CapiSendResult> {
  const eventTime = Math.floor(Date.now() / 1000);
  const testEventCode = sanitizeTestEventCode(input.testEventCode);

  const userData: Record<string, unknown> = {
    external_id: hashForCapi(input.contactId),
  };
  if (input.phone) {
    const ph = normalizePhoneForCapi(input.phone);
    if (ph) userData.ph = [hashForCapi(ph)];
  }
  if (input.email?.includes("@")) {
    userData.em = [hashForCapi(input.email)];
  }

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: "Lead",
        event_time: eventTime,
        event_id: input.eventId,
        action_source: "other",
        user_data: userData,
      },
    ],
    partner_agent: PARTNER_AGENT,
  };

  if (testEventCode) {
    payload.test_event_code = testEventCode;
  }

  return postCapiPayload(input.pixelId, input.accessToken, payload);
}

interface LoadedCapiConfig {
  pixelId: string;
  accessToken: string;
  testEventCode: string | null;
  sendLeadOnFirstMessage: boolean;
  sendQualifiedLeadOnNewContact: boolean;
  /** When true, send ViewContent on every subsequent inbound message. */
  sendViewContentOnEveryMessage: boolean;
  wabaId: string | null;
  pageId: string | null;
  /** False until Meta accepts business_messaging once for this dataset. */
  pageAssociated: boolean;
  configId: string;
}

async function loadEnabledConfig(
  accountId: string,
): Promise<LoadedCapiConfig | null> {
  const { data, error } = await adminDb()
    .from("facebook_capi_config")
    .select(
      "id, pixel_id, access_token, test_event_code, enabled, send_lead_on_first_message, send_qualified_lead_on_new_contact, send_view_content_on_every_message, waba_id, page_id, page_associated",
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
    testEventCode: sanitizeTestEventCode(data.test_event_code),
    sendLeadOnFirstMessage: data.send_lead_on_first_message !== false,
    sendQualifiedLeadOnNewContact:
      data.send_qualified_lead_on_new_contact !== false,
    // Default true — migration 043 adds this column with DEFAULT true, but a
    // row inserted before the migration would return null here, so treat null
    // as true so existing installs start sending ViewContent immediately.
    sendViewContentOnEveryMessage:
      data.send_view_content_on_every_message !== false,
    wabaId: data.waba_id,
    pageId: data.page_id,
    pageAssociated: Boolean(data.page_associated),
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
    // Never persist soft messaging notes as hard failures when Lead succeeded.
    last_error: result.ok ? null : (result.error || "unknown").slice(0, 500),
    updated_at: new Date().toISOString(),
  };
  if (result.ok) {
    patch.last_event_at = new Date().toISOString();
    if (result.mode === "business_messaging" && !result.usedLeadFallback) {
      patch.page_associated = true;
    }
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
  /**
   * The text content of the inbound message (or a label like "[image]").
   * Sent as custom_data.content_name on ViewContent events so Meta can
   * use the message intent to improve ad delivery.
   */
  messageText?: string | null;
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

    let messengerPsid = params.messengerPsid;
    let phone = params.phone;
    let email = params.email;
    if (
      params.channel === "messenger" &&
      !isValidMessengerPsid(messengerPsid)
    ) {
      const { data: contact } = await adminDb()
        .from("contacts")
        .select("messenger_psid, phone, email")
        .eq("id", params.contactId)
        .eq("account_id", params.accountId)
        .maybeSingle();
      messengerPsid = contact?.messenger_psid ?? null;
      if (!phone && contact?.phone) phone = contact.phone;
      if (!email && contact?.email) email = contact.email;
    }

    // Missing PSID no longer aborts — sendCapiEventWithLeadFallback uses
    // classic Lead (action_source=other) so ads still get a signal while
    // Page↔Dataset messaging link is blocked (e.g. Review needed).

    const user: CapiUserIdentifiers = {
      contactId: params.contactId,
      phone,
      email,
      ctwaClid: params.ctwaClid,
      messengerPsid,
      pageId,
      wabaId,
    };

    const eventTime = params.eventTime ?? Math.floor(Date.now() / 1000);
    const results: CapiSendResult[] = [];
    const preferLeadFirst = !cfg.pageAssociated;

    // New contact → QualifiedLead (Lead tag applied in CRM)
    if (params.wasCreated && cfg.sendQualifiedLeadOnNewContact) {
      const r = await sendCapiEventWithLeadFallback({
        pixelId: cfg.pixelId,
        accessToken: cfg.accessToken,
        testEventCode: cfg.testEventCode,
        eventName: "QualifiedLead",
        eventId: `ql_${params.contactId}`,
        eventTime,
        channel: params.channel,
        user,
        preferLeadFirst,
      });
      results.push(r);
      if (!r.ok) console.error("[capi] QualifiedLead failed", r.error);
      else if (r.usedLeadFallback) {
        console.info("[capi] QualifiedLead via Lead fallback");
      }
    }

    // First inbound message → LeadSubmitted (Meta messaging standard)
    if (params.isFirstInbound && cfg.sendLeadOnFirstMessage) {
      const r = await sendCapiEventWithLeadFallback({
        pixelId: cfg.pixelId,
        accessToken: cfg.accessToken,
        testEventCode: cfg.testEventCode,
        eventName: "LeadSubmitted",
        // Dedup by message id so Meta retries don't double-count
        eventId: `lead_${params.messageId}`,
        eventTime,
        channel: params.channel,
        user,
        preferLeadFirst,
      });
      results.push(r);
      if (!r.ok) console.error("[capi] LeadSubmitted failed", r.error);
      else if (r.usedLeadFallback) {
        console.info("[capi] LeadSubmitted via Lead fallback");
      }
    }

    // Subsequent messages → ViewContent (engagement signal for every chat turn).
    // Meta uses ViewContent to understand who is actively engaged and what they
    // are talking about, which feeds lookalike audiences and ad optimisation.
    // Even routine messages ("ami hisu korbo", "price koto?") are valuable
    // because they tell Meta this person is a real, active lead.
    if (
      !params.isFirstInbound &&
      !params.wasCreated &&
      results.length === 0 &&
      cfg.sendViewContentOnEveryMessage
    ) {
      const customData: Record<string, unknown> = {};
      // Include sanitised message text so Meta can infer intent / topic.
      // Truncate to 255 chars — CAPI custom_data string limit.
      const msgText = params.messageText?.trim();
      if (msgText) {
        customData.content_name = msgText.slice(0, 255);
      }
      customData.content_category = "message";
      customData.channel = params.channel;

      const r = await sendCapiEventWithLeadFallback({
        pixelId: cfg.pixelId,
        accessToken: cfg.accessToken,
        testEventCode: cfg.testEventCode,
        eventName: "ViewContent",
        // Dedupe by message id so Meta retries never double-count.
        eventId: `vc_${params.messageId}`,
        eventTime,
        channel: params.channel,
        user,
        preferLeadFirst,
        customData,
      });
      results.push(r);
      if (!r.ok) {
        console.error("[capi] ViewContent failed", r.error);
      }
    }

    const last = results[results.length - 1];
    if (last) {
      await markConfigResult(cfg.configId, last).catch(() => {});
    }
  } catch (err) {
    console.error("[capi] fireCapiForInbound unexpected", err);
  }
}
