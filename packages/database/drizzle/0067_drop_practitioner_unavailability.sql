-- Retire the practitioner_unavailability system (data backfilled into
-- blocked_time in 0066). Dropping a table also drops its RLS policies and the
-- child's FK, so explicit DROP POLICY statements are unnecessary — and in fact
-- error, because dropping the parent CASCADE removes the child policy that
-- references it before a separate DROP POLICY can run. Drop child first.
DROP TABLE IF EXISTS "practitioner_unavailability_exception" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "practitioner_unavailability" CASCADE;
