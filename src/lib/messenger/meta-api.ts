/**
 * Facebook Page Messenger — Graph API helpers (text MVP).
 *
 * Docs: https://developers.facebook.com/docs/messenger-platform/send-messages
 */

const GRAPH = "https://graph.facebook.com/v21.0";

export async function fetchMessengerPageProfile(accessToken: string): Promise<{
  id: string;
  name: string;
}> {
  const res = await fetch(
    `${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`,
  );
  const json = (await res.json()) as {
    id?: string;
    name?: string;
    error?: { message?: string };
  };
  if (!res.ok || !json.id) {
    throw new Error(json.error?.message || "Failed to load Facebook Page");
  }
  return { id: json.id, name: json.name || "Facebook Page" };
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
