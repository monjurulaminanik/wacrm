/**
 * Paginated Graph backfill of Facebook Page Messenger threads into CRM.
 *
 * Usage:
 *   node scripts/backfill-messenger.mjs
 *   node scripts/backfill-messenger.mjs --days=90 --page-id=821488564371982
 *
 * Idempotent: skips messages that already exist by Meta `message_id`.
 * Does not wipe messenger_config or existing rows.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}

function decrypt(encryptedText) {
  const parts = encryptedText.split(":");
  if (parts.length !== 3) throw new Error("Unexpected token encryption format");
  const [ivHex, ctHex, tagHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(process.env.ENCRYPTION_KEY, "hex"),
    iv,
  );
  decipher.setAuthTag(authTag);
  return decipher.update(ctHex, "hex", "utf8") + decipher.final("utf8");
}

function argValue(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const GRAPH = "https://graph.facebook.com/v21.0";
const PAGE_ID = argValue("page-id", "821488564371982");
const DAYS = Number(argValue("days", "90"));
const CONV_LIMIT = Number(argValue("conv-limit", "25"));
const MSG_LIMIT = Number(argValue("msg-limit", "50"));
const CUTOFF = Date.now() - DAYS * 24 * 60 * 60 * 1000;

async function graphGet(url) {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) {
    const msg = json?.error?.message || JSON.stringify(json);
    throw new Error(`Graph ${res.status}: ${msg}`);
  }
  return json;
}

async function fetchAllPages(firstUrl, { stopWhen } = {}) {
  const rows = [];
  let url = firstUrl;
  let pages = 0;
  while (url) {
    pages += 1;
    const json = await graphGet(url);
    const batch = json.data || [];
    rows.push(...batch);
    if (stopWhen && batch.some(stopWhen)) break;
    url = json.paging?.next || null;
    if (pages > 200) {
      console.warn("Aborting after 200 Graph pages (safety)");
      break;
    }
  }
  return rows;
}

async function fetchMessagesForThread(threadId, token) {
  const fields = "id,message,from,created_time";
  const first =
    `${GRAPH}/${threadId}/messages?fields=${fields}` +
    `&limit=${MSG_LIMIT}&access_token=${encodeURIComponent(token)}`;
  const msgs = await fetchAllPages(first, {
    stopWhen: (m) => {
      const t = m.created_time ? Date.parse(m.created_time) : NaN;
      return Number.isFinite(t) && t < CUTOFF;
    },
  });
  // Graph returns newest-first; keep chronological for inserts / last_message.
  return msgs
    .filter((m) => {
      const t = m.created_time ? Date.parse(m.created_time) : Date.now();
      return t >= CUTOFF;
    })
    .reverse();
}

loadEnv();

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const stats = {
  threadsSeen: 0,
  threadsInWindow: 0,
  threadsNew: 0,
  contactsNew: 0,
  messagesImported: 0,
  messagesSkipped: 0,
  errors: 0,
};

(async () => {
  console.log(
    `Backfill page=${PAGE_ID} days=${DAYS} cutoff=${new Date(CUTOFF).toISOString()}`,
  );

  const { data: cfg, error: cfgErr } = await sb
    .from("messenger_config")
    .select("access_token, user_id, account_id, page_id, page_name, status")
    .eq("page_id", PAGE_ID)
    .single();
  if (cfgErr || !cfg) throw new Error(cfgErr?.message || "messenger_config missing");
  if (cfg.status !== "connected") {
    console.warn("WARN: messenger_config status is", cfg.status);
  }

  const token = decrypt(cfg.access_token);
  const accountId = cfg.account_id;
  const userId = cfg.user_id;

  const fields =
    "id,updated_time,participants{id,name},link";
  const firstUrl =
    `${GRAPH}/${PAGE_ID}/conversations?fields=${fields}` +
    `&limit=${CONV_LIMIT}&access_token=${encodeURIComponent(token)}`;

  const threads = await fetchAllPages(firstUrl, {
    stopWhen: (t) => {
      const tMs = t.updated_time ? Date.parse(t.updated_time) : NaN;
      return Number.isFinite(tMs) && tMs < CUTOFF;
    },
  });

  console.log(`Graph returned ${threads.length} conversation page rows`);

  for (const thread of threads) {
    stats.threadsSeen += 1;
    const updatedMs = thread.updated_time
      ? Date.parse(thread.updated_time)
      : NaN;
    if (Number.isFinite(updatedMs) && updatedMs < CUTOFF) continue;
    stats.threadsInWindow += 1;

    const participants = thread.participants?.data || [];
    const customer = participants.find((p) => p.id !== PAGE_ID);
    if (!customer?.id) {
      console.warn("Skip thread without customer participant", thread.id);
      continue;
    }

    const psid = customer.id;
    const name = customer.name || `Messenger ${psid.slice(-6)}`;

    let contactId;
    const { data: existingContact } = await sb
      .from("contacts")
      .select("id, name")
      .eq("account_id", accountId)
      .eq("messenger_psid", psid)
      .maybeSingle();

    if (existingContact) {
      contactId = existingContact.id;
      if (
        customer.name &&
        (!existingContact.name ||
          existingContact.name.startsWith("Messenger "))
      ) {
        await sb
          .from("contacts")
          .update({ name: customer.name })
          .eq("id", contactId);
      }
    } else {
      const { data: created, error } = await sb
        .from("contacts")
        .insert({
          user_id: userId,
          account_id: accountId,
          phone: null,
          messenger_psid: psid,
          channel: "messenger",
          name,
        })
        .select("id")
        .single();
      if (error) {
        console.error("CONTACT_ERR", error.message, psid);
        stats.errors += 1;
        continue;
      }
      contactId = created.id;
      stats.contactsNew += 1;
    }

    let conversationId;
    let existingUnread = 0;
    const { data: existingConv } = await sb
      .from("conversations")
      .select("id, unread_count, last_message_at")
      .eq("account_id", accountId)
      .eq("contact_id", contactId)
      .eq("channel", "messenger")
      .maybeSingle();

    if (existingConv) {
      conversationId = existingConv.id;
      existingUnread = existingConv.unread_count || 0;
    } else {
      const { data: createdConv, error } = await sb
        .from("conversations")
        .insert({
          user_id: userId,
          account_id: accountId,
          contact_id: contactId,
          channel: "messenger",
          status: "open",
          unread_count: 0,
        })
        .select("id")
        .single();
      if (error) {
        console.error("CONV_CREATE_ERR", error.message, name);
        stats.errors += 1;
        continue;
      }
      conversationId = createdConv.id;
      stats.threadsNew += 1;
    }

    let msgs;
    try {
      msgs = await fetchMessagesForThread(thread.id, token);
    } catch (err) {
      console.error("MSG_FETCH_ERR", name, err.message);
      stats.errors += 1;
      continue;
    }

    let lastText = null;
    let lastAt = null;
    let newCustomer = 0;

    for (const m of msgs) {
      if (!m.id) continue;
      const text = (m.message || "").trim();
      // Skip empty non-text (stickers/attachments without message body) for MVP
      // but still advance last_at if we already have preview from others.
      const { data: exists } = await sb
        .from("messages")
        .select("id")
        .eq("message_id", m.id)
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

      const fromPage = m.from?.id === PAGE_ID;
      const { error: msgErr } = await sb.from("messages").insert({
        conversation_id: conversationId,
        sender_type: fromPage ? "agent" : "customer",
        content_type: "text",
        content_text: text,
        message_id: m.id,
        status: "delivered",
        created_at: m.created_time || new Date().toISOString(),
      });
      if (msgErr) {
        console.error("MSG_ERR", msgErr.message, m.id);
        stats.errors += 1;
        continue;
      }
      stats.messagesImported += 1;
      if (!fromPage) newCustomer += 1;
      lastText = text;
      lastAt = m.created_time || new Date().toISOString();
    }

    // Prefer the true latest message timestamp from DB if we skipped many.
    if (!lastAt || !lastText) {
      const { data: latest } = await sb
        .from("messages")
        .select("content_text, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest) {
        lastText = latest.content_text;
        lastAt = latest.created_at;
      }
    }

    if (lastText && lastAt) {
      await sb
        .from("conversations")
        .update({
          last_message_text: lastText.slice(0, 500),
          last_message_at: lastAt,
          unread_count: existingUnread + newCustomer,
          status: "open",
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversationId);
    }

    console.log(
      `OK ${name} msgs=${msgs.length} imported_batch_so_far=${stats.messagesImported}`,
    );
  }

  console.log("DONE", JSON.stringify(stats, null, 2));
})().catch((e) => {
  console.error("FATAL", e.message);
  process.exit(1);
});
