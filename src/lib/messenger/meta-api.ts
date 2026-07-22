/**
 * Facebook Page Messenger — Graph API helpers (text MVP).
 *
 * Docs: https://developers.facebook.com/docs/messenger-platform/send-messages
 */

const GRAPH = "https://graph.facebook.com/v21.0";

/** Placeholder / autofill values that must never be treated as a real Page ID. */
function isUsablePageId(value: string | undefined | null): value is string {
  if (!value) return false;
  if (!/^\d{5,}$/.test(value)) return false;
  // Old form placeholder — never a real Page.
  if (value === "123456789012345") return false;
  return true;
}

function appAccessToken(): string | null {
  const appId =
    process.env.META_APP_ID?.trim() ||
    process.env.NEXT_PUBLIC_META_APP_ID?.trim();
  const secret = process.env.META_APP_SECRET?.trim();
  if (!appId || !secret) return null;
  return `${appId}|${secret}`;
}

/**
 * Validate a Page Access Token via debug_token (no pages_read_engagement).
 * Returns the Page id when the token is a valid PAGE token for our app.
 */
async function resolvePageIdViaDebugToken(
  pageAccessToken: string,
): Promise<{ id: string; name: string } | null> {
  const appToken = appAccessToken();
  if (!appToken) return null;

  const url =
    `${GRAPH}/debug_token?input_token=${encodeURIComponent(pageAccessToken)}` +
    `&access_token=${encodeURIComponent(appToken)}`;
  const res = await fetch(url);
  const json = (await res.json()) as {
    data?: {
      is_valid?: boolean;
      type?: string;
      app_id?: string;
      profile_id?: string;
      user_id?: string;
      error?: { message?: string };
    };
    error?: { message?: string };
  };

  if (!res.ok || json.error) return null;
  const data = json.data;
  if (!data?.is_valid) return null;

  // PAGE tokens expose the Page as profile_id; some payloads use user_id.
  const pageId = data.profile_id || data.user_id;
  if (!pageId) return null;

  // Optional name — ignore permission errors.
  let name = "Facebook Page";
  try {
    const nameRes = await fetch(
      `${GRAPH}/${pageId}?fields=name&access_token=${encodeURIComponent(pageAccessToken)}`,
    );
    const nameJson = (await nameRes.json()) as { name?: string };
    if (nameRes.ok && nameJson.name) name = nameJson.name;
  } catch {
    // keep default
  }

  return { id: pageId, name };
}

/**
 * Resolve Page id + name from a Page Access Token.
 *
 * Avoids relying on `/me?fields=name`, which Meta often blocks without
 * `pages_read_engagement` / Page Public Metadata Access during Dev mode.
 */
export async function fetchMessengerPageProfile(
  accessToken: string,
  pageIdHint?: string,
): Promise<{
  id: string;
  name: string;
}> {
  const errors: string[] = [];

  // 1) Preferred: App debug_token — works with pages_messaging alone.
  try {
    const viaDebug = await resolvePageIdViaDebugToken(accessToken);
    if (viaDebug) {
      if (
        isUsablePageId(pageIdHint) &&
        pageIdHint !== viaDebug.id
      ) {
        throw new Error(
          `Page ID mismatch: token belongs to ${viaDebug.id}, not ${pageIdHint}`,
        );
      }
      return viaDebug;
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Page ID mismatch")) {
      throw err;
    }
    // continue to fallbacks
  }

  const tokenQ = `access_token=${encodeURIComponent(accessToken)}`;

  async function tryUrl(
    url: string,
  ): Promise<{ id: string; name: string } | null> {
    const res = await fetch(url);
    const json = (await res.json()) as {
      id?: string;
      name?: string;
      error?: { message?: string };
    };
    if (!res.ok || !json.id) {
      if (json.error?.message) errors.push(json.error.message);
      return null;
    }
    return { id: json.id, name: json.name || "Facebook Page" };
  }

  // 2) Explicit Page ID from the form (real digits only).
  if (isUsablePageId(pageIdHint)) {
    const byId = await tryUrl(
      `${GRAPH}/${pageIdHint}?fields=id,name&${tokenQ}`,
    );
    if (byId) return byId;
    // Token is accepted for messaging even when name/metadata is blocked.
    // Save with the known Page ID so webhook + send still work.
    return { id: pageIdHint, name: "Facebook Page" };
  }

  // 3) Last resort `/me` (may need pages_read_engagement on some apps).
  const meId = await tryUrl(`${GRAPH}/me?fields=id&${tokenQ}`);
  if (meId) return meId;

  throw new Error(
    errors[0] ||
      "Could not validate Page token. Paste the token from Meta → Generate, leave Page ID blank, and ensure META_APP_ID is set on the server.",
  );
}

export async function sendMessengerText(params: {
  pageAccessToken: string;
  recipientPsid: string;
  text: string;
}): Promise<{ messageId: string }> {
  const res = await fetch(`${GRAPH}/me/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.pageAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient: { id: params.recipientPsid },
      messaging_type: "RESPONSE",
      message: { text: params.text },
    }),
  });
  const json = (await res.json()) as {
    message_id?: string;
    error?: { message?: string; code?: number };
  };
  if (!res.ok || !json.message_id) {
    throw new Error(
      json.error?.message
        ? `Messenger API error: ${json.error.message}`
        : "Failed to send Messenger message",
    );
  }
  return { messageId: json.message_id };
}

/**
 * Subscribe a Facebook Page to this Meta app's webhook (Page object).
 * Idempotent — Meta returns success even when already subscribed.
 *
 * Without this call, the app-level webhook callback can be active while
 * the Page still delivers nothing (common after token regenerate / app
 * reconnect). Requires a Page Access Token with `pages_messaging`.
 *
 * Docs: https://developers.facebook.com/docs/graph-api/reference/page/subscribed_apps
 */
export async function subscribeMessengerPageToApp(params: {
  pageId: string;
  pageAccessToken: string;
  /** Defaults to the fields our inbound webhook handles. */
  subscribedFields?: string[];
}): Promise<void> {
  const fields = (
    params.subscribedFields ?? [
      "messages",
      "messaging_postbacks",
      "message_deliveries",
      "message_reads",
    ]
  ).join(",");

  const body = new URLSearchParams();
  body.set("subscribed_fields", fields);

  const res = await fetch(`${GRAPH}/${params.pageId}/subscribed_apps`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.pageAccessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const json = (await res.json()) as {
    success?: boolean;
    error?: { message?: string; code?: number };
  };
  if (!res.ok || json.success !== true) {
    throw new Error(
      json.error?.message
        ? `Page subscribed_apps failed: ${json.error.message}`
        : `Page subscribed_apps failed (${res.status})`,
    );
  }
}

/** Best-effort display name from Messenger Profile API. */
export async function fetchMessengerUserName(params: {
  pageAccessToken: string;
  psid: string;
}): Promise<string | null> {
  try {
    const res = await fetch(
      `${GRAPH}/${params.psid}?fields=name,first_name,last_name&access_token=${encodeURIComponent(params.pageAccessToken)}`,
    );
    const json = (await res.json()) as {
      name?: string;
      first_name?: string;
      last_name?: string;
    };
    if (!res.ok) return null;
    if (json.name) return json.name;
    const parts = [json.first_name, json.last_name].filter(Boolean);
    return parts.length ? parts.join(" ") : null;
  } catch {
    return null;
  }
}
