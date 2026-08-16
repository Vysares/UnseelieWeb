-- ============================================================
-- Unseelie Workshop — drop everything
--
-- DESTRUCTIVE. Every order, review, and moderation record goes.
--
-- Here because 0001_init.sql is edited in place rather than being
-- followed by migrations, which is the right call while the only data
-- is test data — but it means an already-applied schema has to be torn
-- down before the new one can go on.
--
--   npx wrangler d1 execute unseelie_reviews --local  --file db/reset.sql
--   npx wrangler d1 migrations apply unseelie_reviews --local
--
-- Swap --local for --remote to do the same to the deployed database.
--
-- Do not run this once real orders exist. At that point schema changes
-- need a numbered migration instead.
-- ============================================================

DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS invites;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS outbox;
DROP TABLE IF EXISTS moderation_log;
DROP TABLE IF EXISTS suppressions;
DROP TABLE IF EXISTS webhook_events;
DROP TABLE IF EXISTS orders;

-- Left over from an earlier shape; harmless if it was never created.
DROP TABLE IF EXISTS blocked_submissions;
DROP TABLE IF EXISTS reword_prompts;

-- Wrangler records applied migrations here. Clearing it is what lets
-- 0001_init.sql run again.
DELETE FROM d1_migrations;
