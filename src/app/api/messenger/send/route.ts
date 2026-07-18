import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { sendMessengerToConversation } from "@/lib/messenger/send-message";
import { SendMessageError } from "@/lib/whatsapp/send-message";

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

    const limit = checkRateLimit(`send:${user.id}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);

    const { data: profile } = await supabase
      .from("profiles")
      .select("account_id")
      .eq("user_id", user.id)
      .maybeSingle();
    const accountId = profile?.account_id as string | undefined;
    if (!accountId) {
      return NextResponse.json(
        { error: "Your profile is not linked to an account." },
        { status: 403 },
      );
    }

    const body = await request.json();
    const conversationId = body.conversation_id as string | undefined;
    const contentText = body.content_text as string | undefined;
    const replyTo = body.reply_to_message_id as string | undefined;

    if (!conversationId) {
      return NextResponse.json(
        { error: "conversation_id is required" },
        { status: 400 },
      );
    }

    const result = await sendMessengerToConversation(
      supabase,
      accountId,
      conversationId,
      contentText || "",
      replyTo,
    );

    return NextResponse.json({
      success: true,
      message_id: result.messageId,
      messenger_message_id: result.messengerMessageId,
    });
  } catch (err) {
    if (err instanceof SendMessageError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[messenger/send]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
