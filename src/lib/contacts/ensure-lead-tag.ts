import type { SupabaseClient } from "@supabase/supabase-js";

const LEAD_TAG_NAME = "Lead";
const LEAD_TAG_COLOR = "#C4A574";

/**
 * Ensure the account has a "Lead" tag and attach it to a newly created
 * contact (WhatsApp / Messenger inbound). Idempotent.
 */
export async function ensureContactLeadTag(
  db: SupabaseClient,
  params: {
    accountId: string;
    userId: string;
    contactId: string;
  },
): Promise<void> {
  const { accountId, userId, contactId } = params;

  let tagId: string | null = null;

  const { data: existing } = await db
    .from("tags")
    .select("id")
    .eq("account_id", accountId)
    .eq("name", LEAD_TAG_NAME)
    .maybeSingle();

  if (existing?.id) {
    tagId = existing.id;
  } else {
    const { data: created, error } = await db
      .from("tags")
      .insert({
        account_id: accountId,
        user_id: userId,
        name: LEAD_TAG_NAME,
        color: LEAD_TAG_COLOR,
      })
      .select("id")
      .single();

    if (error || !created) {
      // Race: another inbound created the tag — re-fetch.
      const { data: raced } = await db
        .from("tags")
        .select("id")
        .eq("account_id", accountId)
        .eq("name", LEAD_TAG_NAME)
        .maybeSingle();
      tagId = raced?.id ?? null;
    } else {
      tagId = created.id;
    }
  }

  if (!tagId) return;

  const { error: linkErr } = await db.from("contact_tags").insert({
    contact_id: contactId,
    tag_id: tagId,
  });

  // Unique violation = already tagged — fine.
  if (linkErr && (linkErr as { code?: string }).code !== "23505") {
    console.error("[ensureContactLeadTag]", linkErr);
  }
}
