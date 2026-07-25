/**
 * Messenger Graph polling / sync fallback.
 *
 * Webhook = instant primary path. This job = must-catch-up when Meta
 * drops webhooks. Idempotent by Meta message `id` → messages.message_id.
 *
 * Bangla hint for operators:
 *   Live + webhook = তৎক্ষণাৎ Inbox-এ আসে;
 *   sync job = Meta webhook মিস করলেও কয়েক মিনিটের মধ্যে CRM-এ ধরে।
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/whatsapp/encryption";
import { isUniqueViolation } from "@/lib/contacts/dedupe";
import { ensureContactLeadTag } from "@/lib/contacts/ensure-lead-tag";

const GRAPH = "https://graph.facebook.com/v21.0";

/** Overlap so a slow previous run / clock skew does not skip edges. */
const LOOKBACK_OVERLAP_MS = 15 * 60 * 1000;
/** If never synced, pull this much history (rate-limit friendly). */
const DEFAULT_LOOKBACK_MS = 6 * 60 * 60 * 1000;
const DEFAULT_CONV_LIMIT = 25;
const DEFAULT_MSG_LIMIT = 30;
const MAX_CONV_PAGES = 8;
const MAX_MSG_PAGES = 4;
/** Pause between thread fetches to stay Graph-friendly. */
const THREAD_PAUSE_MS = 120;

export type MessengerSyncStats = {
  accountsAttempted: number;
  accountsOk: number;
  threadsSeen: number;
  messagesImported: number;
  messagesSkipped: number;
  contactsCreated: number;
  errors: string[];
};

type MessengerConfigRow = {
  id: string;
  account_id: string;
  user_id: string;
  page_id: string;
  page_name: string | null;
  access_token: string;
  last_synced_at: string | null;
  status: string;
};

type GraphParticipant = { id?: string; name?: string };
type GraphThread = {
  id?: string;
  updated_time?: string;
  participants?: { data?: GraphParticipant[] };
};
type GraphMessage = {
  id?: string;
  message?: string;
  from?: { id?: string; name?: string };
  created_time?: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function graphGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = (await res.json()) as T & {
    error?: { message?: string; code?: number };
  };
  if (!res.ok) {
    const msg =
      (json as { error?: { message?: string } }).error?.message ||
      `Graph HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

async function fetchPaged<T extends object>(
  firstUrl: string,
  opts: {
    maxPages: number;
    stopWhen?: (row: T) => boolean;
  },
): Promise<T[]> {
  const rows: T[] = [];
  let url: string | null = firstUrl;
  let pages = 0;
  while (url && pages < opts.maxPages) {
    pages += 1;
    const json = await graphGet<{
      data?: T[];
      paging?: { next?: string };
    }>(url);
    const batch = json.data || [];
    rows.push(...batch);
    if (opts.stopWhen && batch.some(opts.stopWhen)) break;
    url = json.paging?.next || null;
  }
  return rows;
}

function cutoffMs(lastSyncedAt: string | null): number {
  if (lastSyncedAt) {
    const t = Date.parse(lastSyncedAt);
    if (Number.isFinite(t)) return t - LOOKBACK_OVERLAP_MS;
  }
  return Date.now() - DEFAULT_LOOKBACK_MS;
}

async function upsertContact(
  db: SupabaseClient,
  cfg: MessengerConfigRow,
  psid: string,
  name: string,
): Promise<{ contactId: string; created: boolean } | null> {
  const { data: existing } = await db
    .from("contacts")
    .select("id, name")
    .eq("account_id", cfg.account_id)
    .eq("messenger_psid", psid)
    .maybeSingle();

  if (existing) {
    if (
      name &&
      (!existing.name || String(existing.name).startsWith("Messenger "))
    ) {
      await db.from("contacts").update({ name }).eq("id", existing.id);
    }
    return { contactId: existing.id, created: false };
  }

  const { data: created, error } = await db
    .from("contacts")
    .insert({
      user_id: cfg.user_id,
      account_id: cfg.account_id,
      phone: null,
      messenger_psid: psid,
      channel: "messenger",
      name,
    })
    .select("id")
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const { data: raced } = await db
        .from("contacts")
        .select("id")
        .eq("account_id", cfg.account_id)
        .eq("messenger_psid", psid)
        .maybeSingle();
      return raced?.id ? { contactId: raced.id, created: false } : null;
    }
    throw error;
  }

  await ensureContactLeadTag(db, {
    accountId: cfg.account_id,
    userId: cfg.user_id,
    contactId: created.id,
  }).catch((err) =>
    console.warn("[messenger/sync] lead tag fail-open", err),
  );

  return { contactId: created.id, created: true };
}

async function ensureConversation(
  db: SupabaseClient,
  cfg: MessengerConfigRow,
  contactId: string,
): Promise<{ conversationId: string; unread: number } | null> {
  const { data: existing } = await db
    .from("conversations")
    .select("id, unread_count")
    .eq("account_id", cfg.account_id)
    .eq("contact_id", contactId)
    .eq("channel", "messenger")
    .maybeSingle();

  if (existing) {
    return {
      conversationId: existing.id,
      unread: existing.unread_count || 0,
    };
  }

  const { data: created, error } = await db
    .from("conversations")
    .insert({
      user_id: cfg.user_id,
      account_id: cfg.account_id,
      contact_id: contactId,
      channel: "messenger",
      status: "open",
      unread_count: 0,
    })
    .select("id")
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const { data: raced } = await db
        .from("conversations")
        .select("id, unread_count")
        .eq("account_id", cfg.account_id)
        .eq("contact_id", contactId)
        .eq("channel", "messenger")
        .maybeSingle();
      return raced
        ? {
            conversationId: raced.id,
            unread: raced.unread_count || 0,
          }
        : null;
    }
    throw error;
  }

  return { conversationId: created.id, unread: 0 };
}

async function syncOneAccount(
  db: SupabaseClient,
  cfg: MessengerConfigRow,
  stats: MessengerSyncStats,
): Promise<void> {
  let token: string;
  try {
    token = decrypt(cfg.access_token);
  } catch (err) {
    stats.errors.push(
      `page ${cfg.page_id}: token decrypt failed — ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  const since = cutoffMs(cfg.last_synced_at);
  const fields = "id,updated_time,participants{id,name}";
  const firstUrl =
    `${GRAPH}/${cfg.page_id}/conversations?fields=${fields}` +
    `&limit=${DEFAULT_CONV_LIMIT}&access_token=${encodeURIComponent(token)}`;

  let threads: GraphThread[];
  try {
    threads = await fetchPaged<GraphThread>(firstUrl, {
      maxPages: MAX_CONV_PAGES,
      stopWhen: (t) => {
        const tMs = t.updated_time ? Date.parse(t.updated_time) : NaN;
        return Number.isFinite(tMs) && tMs < since;
      },
    });
  } catch (err) {
    stats.errors.push(
      `page ${cfg.page_id}: conversations — ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  for (const thread of threads) {
    stats.threadsSeen += 1;
    const updatedMs = thread.updated_time
      ? Date.parse(thread.updated_time)
      : NaN;
    if (Number.isFinite(updatedMs) && updatedMs < since) continue;
    if (!thread.id) continue;

    const participants = thread.participants?.data || [];
    const customer = participants.find((p) => p.id && p.id !== cfg.page_id);
    if (!customer?.id) continue;

    const psid = customer.id;
    const name = customer.name || `Messenger ${psid.slice(-6)}`;

    let contact;
    try {
      contact = await upsertContact(db, cfg, psid, name);
    } catch (err) {
      stats.errors.push(
        `psid ${psid}: contact — ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (!contact) continue;
    if (contact.created) stats.contactsCreated += 1;

    let conv;
    try {
      conv = await ensureConversation(db, cfg, contact.contactId);
    } catch (err) {
      stats.errors.push(
        `psid ${psid}: conversation — ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (!conv) continue;

    const msgFields = "id,message,from,created_time";
    const msgUrl =
      `${GRAPH}/${thread.id}/messages?fields=${msgFields}` +
      `&limit=${DEFAULT_MSG_LIMIT}&access_token=${encodeURIComponent(token)}`;

    let msgs: GraphMessage[];
    try {
      msgs = await fetchPaged<GraphMessage>(msgUrl, {
        maxPages: MAX_MSG_PAGES,
        stopWhen: (m) => {
          const t = m.created_time ? Date.parse(m.created_time) : NaN;
          return Number.isFinite(t) && t < since;
        },
      });
    } catch (err) {
      stats.errors.push(
        `thread ${thread.id}: messages — ${err instanceof Error ? err.message : String(err)}`,
      );
      await sleep(THREAD_PAUSE_MS);
      continue;
    }

    // Graph returns newest-first; chronological insert order.
    const inWindow = msgs
      .filter((m) => {
        if (!m.id) return false;
        const t = m.created_time ? Date.parse(m.created_time) : Date.now();
        return t >= since;
      })
      .reverse();

    let lastText: string | null = null;
    let lastAt: string | null = null;
    let newCustomer = 0;

    for (const m of inWindow) {
      const mid = m.id!;
      const text = (m.message || "").trim();

      const { data: exists } = await db
        .from("messages")
        .select("id")
        .eq("message_id", mid)
        .maybeSingle();
      if (exists) {
        stats.messagesSkipped += 1;
        if (text) {
          lastText = text;
          lastAt = m.created_time || lastAt;
        }
        continue;
      }

      if (!text) {
        stats.messagesSkipped += 1;
        continue;
      }

      const fromPage = m.from?.id === cfg.page_id;
      const { error: msgErr } = await db.from("messages").insert({
        conversation_id: conv.conversationId,
        sender_type: fromPage ? "agent" : "customer",
        content_type: "text",
        content_text: text,
        message_id: mid,
        status: "delivered",
        created_at: m.created_time || new Date().toISOString(),
      });

      if (msgErr) {
        // Race with webhook — treat duplicate as skip (fail-open).
        if (isUniqueViolation(msgErr)) {
          stats.messagesSkipped += 1;
          continue;
        }
        // Select-then-insert race without unique constraint: re-check.
        const { data: again } = await db
          .from("messages")
          .select("id")
          .eq("message_id", mid)
          .maybeSingle();
        if (again) {
          stats.messagesSkipped += 1;
          continue;
        }
        stats.errors.push(`msg ${mid}: ${msgErr.message}`);
        continue;
      }

      stats.messagesImported += 1;
      if (!fromPage) newCustomer += 1;
      lastText = text;
      lastAt = m.created_time || new Date().toISOString();
    }

    if (!lastAt || !lastText) {
      const { data: latest } = await db
        .from("messages")
        .select("content_text, created_at")
        .eq("conversation_id", conv.conversationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest) {
        lastText = latest.content_text;
        lastAt = latest.created_at;
      }
    }

    if (lastText && lastAt) {
      await db
        .from("conversations")
        .update({
          last_message_text: lastText.slice(0, 500),
          last_message_at: lastAt,
          unread_count: conv.unread + newCustomer,
          status: "open",
          updated_at: new Date().toISOString(),
        })
        .eq("id", conv.conversationId);
    }

    await sleep(THREAD_PAUSE_MS);
  }

  // Mark progress even if some threads erred (fail-open catch-up).
  const { error: stampErr } = await db
    .from("messenger_config")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", cfg.id);
  if (stampErr) {
    stats.errors.push(
      `page ${cfg.page_id}: last_synced_at — ${stampErr.message}`,
    );
  } else {
    stats.accountsOk += 1;
  }
}

/**
 * Sync Messenger conversations from Graph into CRM.
 * Cron: all connected configs. Admin UI: pass accountId to scope.
 */
export async function syncMessengerFromGraph(
  db: SupabaseClient,
  opts: { accountId?: string } = {},
): Promise<MessengerSyncStats> {
  const stats: MessengerSyncStats = {
    accountsAttempted: 0,
    accountsOk: 0,
    threadsSeen: 0,
    messagesImported: 0,
    messagesSkipped: 0,
    contactsCreated: 0,
    errors: [],
  };

  let query = db
    .from("messenger_config")
    .select(
      "id, account_id, user_id, page_id, page_name, access_token, last_synced_at, status",
    )
    .eq("status", "connected");

  if (opts.accountId) {
    query = query.eq("account_id", opts.accountId);
  }

  const { data: configs, error } = await query;
  if (error) {
    stats.errors.push(error.message);
    return stats;
  }
  if (!configs?.length) {
    return stats;
  }

  for (const raw of configs) {
    const cfg = raw as MessengerConfigRow;
    stats.accountsAttempted += 1;
    try {
      await syncOneAccount(db, cfg, stats);
    } catch (err) {
      // Never abort the whole cron for one Page.
      stats.errors.push(
        `page ${cfg.page_id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return stats;
}
