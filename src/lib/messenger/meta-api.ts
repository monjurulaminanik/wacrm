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

/**
 * Resolve Page id + name from a Page Access Token.
 *
 * Newer Graph versions sometimes reject `/me?fields=name` without
 * `pages_read_engagement`. We try several lightweight calls so CRM setup
 * works with a normal Messenger Page token.
 */
export async function fetchMessengerPageProfile(
  accessToken: string,
  pageIdHint?: string,
): Promise<{
  id: string;
  name: string;
}> {
  const tokenQ = `access_token=${encodeURIComponent(accessToken)}`;
  const errors: string[] = [];

  async function tryUrl(url: string): Promise<{ id: string; name: string } | null> {
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

  if (isUsablePageId(pageIdHint)) {
    const byId = await tryUrl(
      `${GRAPH}/${pageIdHint}?fields=id,name&${tokenQ}`,
    );
    if (byId) return byId;
    const byIdOnly = await tryUrl(`${GRAPH}/${pageIdHint}?fields=id&${tokenQ}`);
    if (byIdOnly) return byIdOnly;
  }

  // Page Access Tokens resolve `/me` to the Page itself.
  const meNamed = await tryUrl(`${GRAPH}/me?fields=id,name&${tokenQ}`);
  if (meNamed) return meNamed;

  const meId = await tryUrl(`${GRAPH}/me?fields=id&${tokenQ}`);
  if (meId) return meId;

  throw new Error(
    errors[0] ||
      "Failed to load Facebook Page. Use a Page Access Token from Meta → Generate (not a User token), and leave Page ID blank.",
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
