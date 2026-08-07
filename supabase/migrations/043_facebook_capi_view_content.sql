-- 043_facebook_capi_view_content.sql
--
-- Add a toggle so operators can send a ViewContent event to Meta CAPI
-- for every inbound message (not just the first one). Default true so
-- existing installs get the improved signal immediately on upgrade.

ALTER TABLE facebook_capi_config
  ADD COLUMN IF NOT EXISTS send_view_content_on_every_message BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN facebook_capi_config.send_view_content_on_every_message IS
  'When true, fire a ViewContent CAPI event on every inbound message so Meta Pixel '
  'accumulates engagement signals across the whole conversation, not just the first touch.';
