-- ============================================================
-- 040_messenger_last_synced.sql — Graph polling catch-up marker
--
-- Messenger webhooks are primary (instant). A scheduled Graph sync
-- is the safety net when Meta drops deliveries. last_synced_at
-- tracks how far each Page config has been caught up so the sync
-- job can look back only a short overlapping window.
-- ============================================================

ALTER TABLE messenger_config
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
