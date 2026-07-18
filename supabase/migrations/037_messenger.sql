-- ============================================================
-- 037_messenger.sql — Facebook Page Messenger channel
--
-- Adds Messenger as a second inbox channel alongside WhatsApp:
--   1. contacts.phone becomes nullable (Messenger users are PSIDs)
--   2. contacts.messenger_psid + contacts.channel
--   3. conversations.channel + unique (account, contact, channel)
--   4. messenger_config (one Page per account)
-- ============================================================

-- 1) Contacts: allow non-phone identities
ALTER TABLE contacts ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS messenger_psid TEXT;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_channel_check'
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_channel_check
      CHECK (channel IN ('whatsapp', 'messenger'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_messenger_psid
  ON contacts (account_id, messenger_psid)
  WHERE messenger_psid IS NOT NULL AND messenger_psid <> '';

-- 2) Conversations: channel-aware uniqueness
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_channel_check'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_channel_check
      CHECK (channel IN ('whatsapp', 'messenger'));
  END IF;
END $$;

DROP INDEX IF EXISTS idx_conversations_account_contact;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_channel
  ON conversations (account_id, contact_id, channel);

-- 3) messenger_config — mirror whatsapp_config shape (Page-scoped)
CREATE TABLE IF NOT EXISTS messenger_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  page_name TEXT,
  access_token TEXT NOT NULL,
  verify_token TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('connected', 'disconnected')),
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id),
  UNIQUE (page_id)
);

CREATE INDEX IF NOT EXISTS idx_messenger_config_account ON messenger_config(account_id);
CREATE INDEX IF NOT EXISTS idx_messenger_config_page ON messenger_config(page_id);

ALTER TABLE messenger_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS messenger_config_select ON messenger_config;
DROP POLICY IF EXISTS messenger_config_insert ON messenger_config;
DROP POLICY IF EXISTS messenger_config_update ON messenger_config;
DROP POLICY IF EXISTS messenger_config_delete ON messenger_config;

CREATE POLICY messenger_config_select ON messenger_config FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY messenger_config_insert ON messenger_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY messenger_config_update ON messenger_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY messenger_config_delete ON messenger_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON messenger_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON messenger_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
