-- appointment.start_date / end_date: naive `timestamp` → `timestamptz`, matching
-- blocked_time / time_off and the availability resolver (which treat these as
-- real UTC instants). INSTANT-PRESERVING: `AT TIME ZONE 'UTC'` interprets the
-- existing naive value as a UTC wall-clock, yielding the identical instant
-- regardless of the migration session's timezone. NO time shift — existing
-- appointments keep the exact same moment; only the column type changes.
ALTER TABLE "appointment" ALTER COLUMN "start_date" SET DATA TYPE timestamp with time zone USING "start_date" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "appointment" ALTER COLUMN "end_date" SET DATA TYPE timestamp with time zone USING "end_date" AT TIME ZONE 'UTC';
