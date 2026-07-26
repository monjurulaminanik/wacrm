-- ============================================================
-- 041_facebook_capi_page_associated.sql
-- Track whether Meta accepted business_messaging for this
-- dataset (Page↔Dataset linked). Until true, CRM prefers
-- classic Lead (action_source=other) to avoid scary CTM errors.
-- ============================================================

ALTER TABLE facebook_capi_config
  ADD COLUMN IF NOT EXISTS page_associated BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN facebook_capi_config.page_associated IS
  'True after Meta accepts at least one business_messaging event for this dataset (Page linked).';
