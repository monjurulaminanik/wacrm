import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { encrypt, decrypt } from "@/lib/whatsapp/encryption";
import { fetchMessengerPageProfile } from "@/lib/messenger/meta-api";

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
      return NextResponse.json(
        { connected: false, reason: "no_account", message: "No account linked." },
        { status: 200 },
      );
    }

    const { data: config } = await supabase
      .from("messenger_config")
      .select("page_id, page_name, access_token, status")
      .eq("account_id", accountId)
      .maybeSingle();

    if (!config) {
      return NextResponse.json(
        {
          connected: false,
          reason: "no_config",
          message: "No Messenger Page connected yet.",
        },
        { status: 200 },
      );
    }

    try {
      const token = decrypt(config.access_token);
      const page = await fetchMessengerPageProfile(token);
      return NextResponse.json({
        connected: true,
        page_info: { id: page.id, name: page.name },
        status: config.status,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Meta API error";
      return NextResponse.json(
        {
          connected: false,
          reason: "meta_api_error",
          message,
          needs_reset: /decrypt/i.test(message),
        },
        { status: 200 },
      );
    }
  } catch (err) {
    console.error("[messenger/config GET]", err);
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
    const { page_id, access_token, verify_token } = body as {
      page_id?: string;
      access_token?: string;
      verify_token?: string;
    };

    if (!access_token || typeof access_token !== "string") {
      return NextResponse.json(
        { error: "access_token is required" },
        { status: 400 },
      );
    }

    let pageInfo: { id: string; name: string };
    try {
      pageInfo = await fetchMessengerPageProfile(access_token);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid Page token";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (page_id && page_id !== pageInfo.id) {
      return NextResponse.json(
        {
          error: `Page ID mismatch: token belongs to ${pageInfo.id}, not ${page_id}`,
        },
        { status: 400 },
      );
    }

    const { data: claimed } = await supabaseAdmin()
      .from("messenger_config")
      .select("account_id")
      .eq("page_id", pageInfo.id)
      .neq("account_id", accountId)
      .maybeSingle();

    if (claimed) {
      return NextResponse.json(
        {
          error:
            "This Facebook Page is already linked to another account on this CRM.",
        },
        { status: 409 },
      );
    }

    let encryptedAccess: string;
    let encryptedVerify: string | null = null;
    try {
      encryptedAccess = encrypt(access_token);
      encryptedVerify = verify_token ? encrypt(String(verify_token)) : null;
    } catch {
      return NextResponse.json(
        {
          error:
            "Failed to encrypt token. Check ENCRYPTION_KEY is a valid 64-char hex string.",
        },
        { status: 500 },
      );
    }

    const { data: existing } = await supabase
      .from("messenger_config")
      .select("id")
      .eq("account_id", accountId)
      .maybeSingle();

    const row: Record<string, unknown> = {
      user_id: user.id,
      account_id: accountId,
      page_id: pageInfo.id,
      page_name: pageInfo.name,
      access_token: encryptedAccess,
      status: "connected" as const,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (encryptedVerify) {
      row.verify_token = encryptedVerify;
    }

    if (existing) {
      const { error } = await supabase
        .from("messenger_config")
        .update(row)
        .eq("account_id", accountId);
      if (error) {
        console.error("[messenger/config] update", error);
        return NextResponse.json(
          { error: "Failed to update configuration" },
          { status: 500 },
        );
      }
    } else {
      const { error } = await supabase.from("messenger_config").insert(row);
      if (error) {
        console.error("[messenger/config] insert", error);
        return NextResponse.json(
          { error: "Failed to save configuration" },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({
      success: true,
      page_info: { id: pageInfo.id, name: pageInfo.name },
    });
  } catch (err) {
    console.error("[messenger/config POST]", err);
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
      .from("messenger_config")
      .delete()
      .eq("account_id", accountId);

    if (error) {
      return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[messenger/config DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
