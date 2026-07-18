import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/whatsapp/encryption";
import { sendMessengerText } from "@/lib/messenger/meta-api";
import { SendMessageError } from "@/lib/whatsapp/send-message";

export async function sendMessengerToConversation(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  text: string,
  replyToMessageId?: string | null,
): Promise<{ messageId: string; messengerMessageId: string }> {
  const content = (text || "").trim();
  if (!content) {
    throw new SendMessageError("bad_request", "Message text is required", 400);
  }
  if (content.length > 2000) {
    throw new SendMessageError(
      "bad_request",
      "Messenger text messages are limited to 2000 characters",
      400,
    );
  }

  const { data: conversation, error: convErr } = await db
    .from("conversations")
    .select("id, contact_id, channel, account_id")
    .eq("id", conversationId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (convErr || !conversation) {
    throw new SendMessageError("not_found", "Conversation not found", 404);
  }
  if (conversation.channel !== "messenger") {
    throw new SendMessageError(
      "bad_request",
      "Conversation is not a Messenger thread",
      400,
    );
  }

  const { data: contact } = await db
    .from("contacts")
    .select("id, messenger_psid, name")
    .eq("id", conversation.contact_id)
    .eq("account_id", accountId)
    .maybeSingle();

  if (!contact?.messenger_psid) {
    throw new SendMessageError(
      "bad_request",
      "Contact has no Messenger PSID",
      400,
    );
  }

  const { data: config } = await db
    .from("messenger_config")
    .select("access_token, status")
    .eq("account_id", accountId)
    .maybeSingle();

  if (!config) {
    throw new SendMessageError(
      "messenger_not_configured",
      "Messenger not configured. Connect a Facebook Page in Settings.",
      400,
    );
  }

  let accessToken: string;
  try {
    accessToken = decrypt(config.access_token);
  } catch {
    throw new SendMessageError(
      "token_corrupted",
      "Stored Page token cannot be decrypted. Re-save Messenger settings.",
      400,
    );
  }

  let mid: string;
  try {
    const sent = await sendMessengerText({
      pageAccessToken: accessToken,
      recipientPsid: contact.messenger_psid,
      text: content,
    });
    mid = sent.messageId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    throw new SendMessageError("meta_api_error", message, 400);
  }

  const { data: row, error: insertErr } = await db
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_type: "agent",
      content_type: "text",
      content_text: content,
      message_id: mid,
      status: "sent",
      reply_to_message_id: replyToMessageId || null,
    })
    .select("id")
    .single();

  if (insertErr || !row) {
    throw new SendMessageError(
      "db_error",
      "Message sent but failed to save locally",
      500,
    );
  }

  await db
    .from("conversations")
    .update({
      last_message_text: content,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId);

  return { messageId: row.id, messengerMessageId: mid };
}
