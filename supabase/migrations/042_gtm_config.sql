-- ============================================================
-- 042_gtm_config.sql — Google Tag Manager per account
-- ============================================================

CREATE TABLE IF NOT EXISTS gtm_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  container_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id),
  CONSTRAINT gtm_config_container_id_format
    CHECK (container_id ~* '^GTM-[A-Z0-9]+$')
);

CREATE INDEX IF NOT EXISTS idx_gtm_config_account
  ON gtm_config(account_id);

ALTER TABLE gtm_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gtm_config_select ON gtm_config;
DROP POLICY IF EXISTS gtm_config_insert ON gtm_config;
DROP POLICY IF EXISTS gtm_config_update ON gtm_config;
DROP POLICY IF EXISTS gtm_config_delete ON gtm_config;

CREATE POLICY gtm_config_select ON gtm_config FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY gtm_config_insert ON gtm_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY gtm_config_update ON gtm_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY gtm_config_delete ON gtm_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON gtm_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON gtm_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
