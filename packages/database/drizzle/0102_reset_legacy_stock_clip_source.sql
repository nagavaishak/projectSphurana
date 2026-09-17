-- Custom SQL migration file, put your code below! --

-- ============================================================================
-- Reset legacy stock_clip.source to the least-privileged value
-- ============================================================================
-- 0099 added `source` with DEFAULT 'shot'. That was the wrong default: 'shot'
-- and 'pooled' are the two values permitted to carry an agent_slug (see the
-- CHECK constraint stock_clip_agent_requires_declarable_source), so every row
-- that existed before the column did silently acquired the right to assert
-- machine identity.
--
-- 52 rows seeded 2026-07-27/28 were affected. Their origin is not recorded
-- anywhere and is not recoverable — re-analysis can tell us what a clip SHOWS,
-- never where it came from. "Unknown" must not resolve to "we filmed it".
--
-- 0101 changes the default to 'provider'. This resets the rows that already
-- took the old one.
--
-- Discriminator: `vertical` is the deprecated pre-0098 column, populated only
-- by the old seeding path. Rows created since leave it null, so this cannot
-- touch genuine own-shoot footage added later.
--
-- Deliberately NOT reset: agent_slug. It is already null on every affected row
-- (verified before writing this), and if it were not, nulling it here would
-- destroy a declaration this migration has no standing to overrule.
-- ============================================================================

UPDATE "stock_clip"
SET "source" = 'provider'
WHERE "vertical" IS NOT NULL
  AND "source" = 'shot';
