-- ============================================================================
-- Extend the app_public column grants on time_off / blocked_time to location_id.
--
-- 0090 deliberately replaced table-level SELECT on these tables with COLUMN-LIST
-- grants, withholding the personal fields (type, description, created_by_id).
-- A column-list GRANT does not extend to columns added afterwards, and 0151
-- added `location_id` to both. It is therefore unreadable by app_public today —
-- including via `SELECT *`, which errors rather than silently omitting it.
--
-- Latent, like 0156: the readers that exist (list-blocked-time,
-- list-time-off) are dashboard services on app_authenticated. It becomes a
-- live failure as soon as branch-aware availability reaches the public booking
-- engine, which is the reason these columns were added.
--
-- NULL means "every branch" for both tables — an org-wide closure. Getting this
-- wrong in either direction is a booking bug that shows up as a customer being
-- offered a slot at a closed clinic, or a Cork-only closure blocking Dublin.
--
-- Only location_id is added. The withheld personal columns from 0090 stay
-- withheld; this is not a re-grant of the table.
--
-- Idempotent: GRANT of a held privilege is a no-op. Safe to re-run.
-- ============================================================================

GRANT SELECT (location_id) ON time_off TO app_public;--> statement-breakpoint
GRANT SELECT (location_id) ON blocked_time TO app_public;
