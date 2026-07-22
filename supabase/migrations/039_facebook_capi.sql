-- ============================================================
-- 039_facebook_capi.sql — Meta Conversions API (CAPI) for ads
--
-- Account-scoped Pixel / Dataset credentials + engagement tracking
-- so inbound WhatsApp / Messenger messages can feed Meta's
-- Advantage+ / delivery optimization (and Custom Audiences later).
-- ============================================================

-- 1) Per-account CAPI configuration (secrets encrypted at app layer)
CREATE TABLE IF NOT EXISTS facebook_capi_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Pixel ID or Dataset ID (Meta often uses the same id for both)
  pixel_id TEXT NOT NULL,
  -- System User / CAPI access token — AES-256-GCM encrypted in app
  access_token TEXT NOT NULL,
  -- Optional Events Manager test code (Events Manager → Test events)
  test_event_code TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  -- Event toggles
  send_lead_on_first_message BOOLEAN NOT NULL DEFAULT true,
  send_qualified_lead_on_new_contact BOOLEAN NOT NULL DEFAULT true,
  -- Optional overrides (otherwise resolved from whatsapp/messenger config)
  waba_id TEXT,
  page_id TEXT,
  last_error TEXT,
  last_event_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id)
);

CREATE INDEX IF NOT EXISTS idx_facebook_capi_config_account
  ON facebook_capi_config(account_id);

ALTER TABLE facebook_capi_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS facebook_capi_config_select ON facebook_capi_config;
DROP POLICY IF EXISTS facebook_capi_config_insert ON facebook_capi_config;
DROP POLICY IF EXISTS facebook_capi_config_update ON facebook_capi_config;
DROP POLICY IF EXISTS facebook_capi_config_delete ON facebook_capi_config;

CREATE POLICY facebook_capi_config_select ON facebook_capi_config FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY facebook_capi_config_insert ON facebook_capi_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY facebook_capi_config_update ON facebook_capi_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY facebook_capi_config_delete ON facebook_capi_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON facebook_capi_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON facebook_capi_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2) Engaged contacts (messaged us) — Custom Audience / lookalike seed later
CREATE TABLE IF NOT EXISTS facebook_capi_engagements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'messenger')),
  first_engaged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_engaged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  inbound_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE (account_id, contact_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_facebook_capi_engagements_account
  ON facebook_capi_engagements(account_id);
CREATE INDEX IF NOT EXISTS idx_facebook_capi_engagements_contact
  ON facebook_capi_engagements(contact_id);

ALTER TABLE facebook_capi_engagements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS facebook_capi_engagements_select ON facebook_capi_engagements;
DROP POLICY IF EXISTS facebook_capi_engagements_insert ON facebook_capi_engagements;
DROP POLICY IF EXISTS facebook_capi_engagements_update ON facebook_capi_engagements;
DROP POLICY IF EXISTS facebook_capi_engagements_delete ON facebook_capi_engagements;

CREATE POLICY facebook_capi_engagements_select ON facebook_capi_engagements FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY facebook_capi_engagements_insert ON facebook_capi_engagements FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY facebook_capi_engagements_update ON facebook_capi_engagements FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY facebook_capi_engagements_delete ON facebook_capi_engagements FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- 3) Persist CTWA click id on contacts when present on inbound WhatsApp
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS ctwa_clid TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_ctwa_clid
  ON contacts (account_id, ctwa_clid)
  WHERE ctwa_clid IS NOT NULL AND ctwa_clid <> '';
