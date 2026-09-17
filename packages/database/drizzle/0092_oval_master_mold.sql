CREATE TYPE "public"."booking_destination" AS ENUM('borradh', 'external_link');--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "booking_destination" "booking_destination" DEFAULT 'borradh' NOT NULL;--> statement-breakpoint
-- Backfill: reproduce the OLD predicate exactly, so no organization's booking
-- link changes. `usesNativeCalendar()` was `primaryCalendarType === 'borradh'`,
-- and everything else fell through to `defaultBookingLink`.
--
-- The column default is 'borradh', which is right for new organizations but
-- wrong for the 48 existing orgs that book externally — without this they
-- would silently be switched onto the Borradh booking page. Verified with
-- scripts/booking-link-parity.mjs: zero organizations change link.
UPDATE "organization"
SET "booking_destination" = CASE
      WHEN "primary_calendar_type" = 'borradh' THEN 'borradh'::"public"."booking_destination"
      ELSE 'external_link'::"public"."booking_destination"
    END;
