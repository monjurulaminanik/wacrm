import { NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { decrypt, encrypt, isLegacyFormat } from "@/lib/whatsapp/encryption";
import { verifyMetaWebhookSignature } from "@/lib/whatsapp/webhook-signature";
import { isUniqueViolation } from "@/lib/contacts/dedupe";
import { fetchMessengerUserName } from "@/lib/messenger/meta-api";

export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}

interface MessengerEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: Array<{ type?: string; payload?: { url?: string } }>;
  };
  delivery?: unknown;
  read?: unknown;
}

/** GET — Meta webhook verification (hub.challenge). */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("hub.mode");
    const challenge = searchParams.get("hub.challenge");
    const verifyToken = searchParams.get("hub.verify_token");

    if (mode !== "subscribe" || !challenge || !verifyToken) {
      return NextResponse.json(
        { error: "Missing verification parameters" },
        { status: 400 },
      );
    }

    // Plaintext env fallback — survives encrypt/decrypt mismatches and
    // lets Meta verify even if messenger_config row is mid-save.
    const envVerify =
      process.env.MESSENGER_VERIFY_TOKEN?.trim() ||
      process.env.META_MESSENGER_VERIFY_TOKEN?.trim();
    if (envVerify && envVerify === verifyToken) {
      return new NextResponse(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const { data: configs, error } = await supabaseAdmin()
      .from("messenger_config")
      .select("id, verify_token");

    if (error || !configs?.length) {
      return NextResponse.json({ error: "Verification failed" }, { status: 403 });
    }

    for (const cfg of configs) {
      if (!cfg.verify_token) continue;
      try {
        const plain = decrypt(cfg.verify_token);
        if (plain === verifyToken) {
          if (isLegacyFormat(cfg.verify_token)) {
            await supabaseAdmin()
              .from("messenger_config")
              .update({ verify_token: encrypt(plain) })
              .eq("id", cfg.id);
          }
          return new NextResponse(challenge, {
            status: 200,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      } catch {
        // try next
      }
    }

    return NextResponse.json({ error: "Verification failed" }, { status: 403 });
  } catch (err) {
    console.error("[messenger/webhook GET]", err);
    return NextResponse.json({ error: "Verification failed" }, { status: 403 });
  }
}

/** POST — inbound Messenger events. */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: {
    object?: string;
    entry?: Array<{ id?: string; messaging?: MessengerEvent[] }>;
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.object !== "page") {
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }

  after(async () => {
    try {
      await processMessengerWebhook(body);
    } catch (err) {
      console.error("[messenger/webhook] processing failed:", err);
    }
  });

  return NextResponse.json({ status: "ok" }, { status: 200 });
}

async function processMessengerWebhook(body: {
  entry?: Array<{ id?: string; messaging?: MessengerEvent[] }>;
}) {
  const db = supabaseAdmin();

  for (const entry of body.entry || []) {
    const pageId = entry.id;
    if (!pageId) continue;

    const { data: config } = await db
      .from("messenger_config")
      .select("id, account_id, user_id, access_token, page_id")
      .eq("page_id", pageId)
      .maybeSingle();

    if (!config) {
      console.warn("[messenger/webhook] no config for page_id", pageId);
      continue;
    }

    let pageToken: string | null = null;
    try {
      pageToken = decrypt(config.access_token);
    } catch (err) {
      console.error("[messenger/webhook] token decrypt failed", err);
    }

    for (const event of entry.messaging || []) {
      // Ignore echoes (messages we sent) and non-message events for MVP.
      if (!event.message || event.message.is_echo) continue;
      const psid = event.sender?.id;
      const mid = event.message.mid;
      if (!psid || !mid) continue;

      const text =
        event.message.text?.trim() ||
        (event.message.attachments?.length
          ? `[${event.message.attachments[0]?.type || "attachment"}]`
          : "");
      if (!text) continue;

      // Dedupe by Meta message id
      const { data: existingMsg } = await db
        .from("messages")
        .select("id")
        .eq("message_id", mid)
        .maybeSingle();
      if (existingMsg) continue;

      let contactId: string | null = null;
      const { data: existingContact } = await db
        .from("contacts")
        .select("id, name")
        .eq("account_id", config.account_id)
        .eq("messenger_psid", psid)
        .maybeSingle();

      if (existingContact) {
        contactId = existingContact.id;
      } else {
        let displayName =
          (pageToken &&
            (await fetchMessengerUserName({
              pageAccessToken: pageToken,
              psid,
            }))) ||
          `Messenger ${psid.slice(-6)}`;

        const { data: created, error: createErr } = await db
          .from("contacts")
          .insert({
            user_id: config.user_id,
            account_id: config.account_id,
            phone: null,
            messenger_psid: psid,
            channel: "messenger",
            name: displayName,
          })
          .select("id")
          .single();

        if (createErr) {
          if (isUniqueViolation(createErr)) {
            const { data: raced } = await db
              .from("contacts")
              .select("id")
              .eq("account_id", config.account_id)
              .eq("messenger_psid", psid)
              .maybeSingle();
            contactId = raced?.id ?? null;
          } else {
            console.error("[messenger/webhook] contact create", createErr);
            continue;
          }
        } else {
          contactId = created.id;
        }
      }

      if (!contactId) continue;

      let conversationId: string | null = null;
      const { data: existingConv } = await db
        .from("conversations")
        .select("id, unread_count")
        .eq("account_id", config.account_id)
        .eq("contact_id", contactId)
        .eq("channel", "messenger")
        .maybeSingle();

      if (existingConv) {
        conversationId = existingConv.id;
        await db
          .from("conversations")
          .update({
            last_message_text: text.slice(0, 500),
            last_message_at: new Date().toISOString(),
            unread_count: (existingConv.unread_count || 0) + 1,
            status: "open",
            updated_at: new Date().toISOString(),
          })
          .eq("id", conversationId);
      } else {
        const { data: createdConv, error: convErr } = await db
          .from("conversations")
          .insert({
            user_id: config.user_id,
            account_id: config.account_id,
            contact_id: contactId,
            channel: "messenger",
            status: "open",
            last_message_text: text.slice(0, 500),
            last_message_at: new Date().toISOString(),
            unread_count: 1,
          })
          .select("id")
          .single();

        if (convErr) {
          if (isUniqueViolation(convErr)) {
            const { data: raced } = await db
              .from("conversations")
              .select("id")
              .eq("account_id", config.account_id)
              .eq("contact_id", contactId)
              .eq("channel", "messenger")
              .maybeSingle();
            conversationId = raced?.id ?? null;
            if (conversationId) {
              await db
                .from("conversations")
                .update({
                  last_message_text: text.slice(0, 500),
                  last_message_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .eq("id", conversationId);
            }
          } else {
            console.error("[messenger/webhook] conversation create", convErr);
            continue;
          }
        } else {
          conversationId = createdConv.id;
        }
      }

      if (!conversationId) continue;

      const { error: msgErr } = await db.from("messages").insert({
        conversation_id: conversationId,
        sender_type: "customer",
        content_type: "text",
        content_text: text,
        message_id: mid,
        status: "delivered",
      });
      if (msgErr) {
        console.error("[messenger/webhook] message insert", msgErr);
      }
    }
  }
}
