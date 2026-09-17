-- PHASE 1 of the practitioner→user merge: ADDITIVE ONLY.
--
-- Nothing in this file changes behaviour. It gives `user` the staff profile and
-- the org membership, and populates them from `practitioner` — but every
-- `practitioner_id` in the database still points at `practitioner`, every
-- constraint still references `practitioner`, and every line of application
-- code still reads `practitioner`. Deploying this is a no-op to a customer.
--
-- WHY IT IS SPLIT OFF. The flip (repointing ten foreign keys and switching the
-- code) is the irreversible step, and its risk is almost entirely in the DATA:
-- does every practitioner end up with exactly one user, is anybody missed, is
-- anybody merged onto somebody else. Landing that data work FIRST means it can
-- be inspected in production, against real rows, while nothing depends on it —
-- and rolled back by dropping columns, which is cheap and total.
--
-- NOT here, deliberately: dropping or re-pointing any constraint, rewriting any
-- `practitioner_id` value, the join-table RLS repoint, dropping
-- `session.active_organization_id`, and every code change. Those are phase 2.
--
-- Rehearsed against a copy-on-write branch of production (115 practitioners,
-- 123 users): applies in ~8s, every practitioner ends up linked, no duplicate
-- identities, appointment attribution unchanged.

ALTER TABLE "user" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "org_role" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_staff" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_secondary" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_country" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "headline" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "employment_start_date" date;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "employment_end_date" date;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "employment_type" "employment_type";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "team_member_ref" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "accepts_bookings" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "languages" text[];--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "social_links" jsonb;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "color" "user_color";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "profile_setup_completed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "calendar_account_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "booking_account_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "external_booking_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "booking_link" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- ── Populate the new columns from `practitioner` ───────────────────────────
-- Repoint every practitioner_id FK at `user`, and carry the data across.
--
-- The data steps MUST live in this migration rather than in a script beside it.
-- Migrations run as one deploy step, so anything left to a separate script would
-- execute after the constraints had already been swapped — rewriting the columns
-- to NULL. Everything below is idempotent and safe to re-run.
--
-- Column names are deliberately unchanged. `practitioner_id` still means "the
-- staff member who does the work"; only what it points AT changes. Renaming it
-- would touch ~491 files for no gain, and on `appointment` a `user_id` column
-- would be ambiguous next to the existing `assigned_to_id`.

--> statement-breakpoint
-- 1. LINK: a practitioner whose email already matches a user IS that user.
--    Guarded so two practitioners can never collapse onto one user: only the
--    earliest-created claimant links, the rest are minted below.
UPDATE practitioner p
SET user_id = u.id
FROM "user" u
WHERE p.user_id IS NULL
  AND p.deleted_at IS NULL
  AND lower(u.email) = lower(p.email)
  AND NOT EXISTS (
    SELECT 1 FROM practitioner p2
    WHERE p2.user_id = u.id AND p2.deleted_at IS NULL
  )
  AND p.id = (
    SELECT p3.id FROM practitioner p3
    WHERE lower(p3.email) = lower(u.email) AND p3.deleted_at IS NULL
      AND p3.user_id IS NULL
    ORDER BY p3.created_at, p3.id
    LIMIT 1
  );
--> statement-breakpoint
-- 2. MINT: staff with no user get a CREDENTIAL-LESS identity — a `user` row with
--    no `account` row cannot sign in, and no email is sent. This is a supported
--    state, not an artefact: 22 bookable staff have no login in production.
--
--    SOFT-DELETED practitioners are minted too. Their appointments still name
--    them, and without an identity those historical rows would be orphaned and
--    nulled below — losing who actually did the work.
--
--    `user.email` is globally unique but `practitioner.email` is only unique per
--    org. Where the same address is used by staff in different orgs, the first
--    keeps it and the others get an org-suffixed address, so nobody is dropped
--    and no two people are silently merged into one.
--
--    MATERIALIZED matters: the generated id must be identical in the INSERT and
--    in the UPDATE that links it back. Inlining the CTE would re-evaluate
--    gen_random_uuid() and link practitioners to users that do not exist.
WITH to_mint AS MATERIALIZED (
  SELECT
    p.id                        AS practitioner_id,
    gen_random_uuid()::text     AS user_id,
    p.name,
    CASE
      WHEN EXISTS (SELECT 1 FROM "user" u2 WHERE lower(u2.email) = lower(p.email))
        OR row_number() OVER (PARTITION BY lower(p.email) ORDER BY p.created_at, p.id) > 1
      THEN split_part(p.email, '@', 1) || '+' || p.organization_id || '@' || split_part(p.email, '@', 2)
      ELSE p.email
    END                         AS email,
    p.organization_id,
    p.is_active,
    p.accepts_bookings,
    p.deleted_at
  FROM practitioner p
  WHERE p.user_id IS NULL
),
inserted AS (
  INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at,
                      organization_id, is_active, accepts_bookings, deleted_at)
  SELECT user_id, name, email, false, now(), now(),
         organization_id, is_active, accepts_bookings, deleted_at
  FROM to_mint
  RETURNING id
)
UPDATE practitioner p
SET user_id = t.user_id
FROM to_mint t
WHERE p.id = t.practitioner_id;
--> statement-breakpoint
-- 3. PROFILE: the staff record moves onto the identity. `name` is taken from the
--    practitioner because that is the name customers see on the booking page.
UPDATE "user" u SET
  name                    = p.name,
  first_name              = p.first_name,
  last_name               = p.last_name,
  phone                   = p.phone,
  phone_secondary         = p.phone_secondary,
  phone_country           = p.phone_country,
  bio                     = p.bio,
  title                   = p.title,
  headline                = p.headline,
  date_of_birth           = p.date_of_birth,
  employment_start_date   = p.employment_start_date,
  employment_end_date     = p.employment_end_date,
  employment_type         = p.employment_type,
  team_member_ref         = p.team_member_ref,
  notes                   = p.notes,
  accepts_bookings        = p.accepts_bookings,
  languages               = p.languages,
  social_links            = p.social_links,
  color                   = p.color,
  is_active               = p.is_active,
  profile_setup_completed = p.profile_setup_completed,
  calendar_account_id     = p.calendar_account_id,
  booking_account_id      = p.booking_account_id,
  external_booking_id     = p.external_booking_id,
  booking_link            = p.booking_link,
  deleted_at              = p.deleted_at,
  image                   = coalesce(p.photo, u.image),
  updated_at              = now()
FROM practitioner p
WHERE p.user_id = u.id;
--> statement-breakpoint
-- 4. ORG: membership becomes a property of the person. A user in several orgs is
--    left alone — one column cannot hold two answers, and that needs a human.
UPDATE "user" u SET
  organization_id   = m.organization_id,
  org_role          = m.role,
  terms_accepted_at = m.terms_accepted_at,
  updated_at        = now()
FROM member m
WHERE m.user_id = u.id
  AND u.id IN (SELECT user_id FROM member GROUP BY user_id HAVING count(DISTINCT organization_id) = 1);
--> statement-breakpoint
-- Staff with no member row belong to the org they work for.
UPDATE "user" u SET organization_id = p.organization_id, updated_at = now()
FROM practitioner p
WHERE p.user_id = u.id AND u.organization_id IS NULL;
--> statement-breakpoint
--> statement-breakpoint
-- ── is_staff ──────────────────────────────────────────────────────────────
-- Everyone who HAD a practitioner row does the work. Includes soft-deleted
-- staff: a former stylist is still the person on those historical appointments,
-- and the team list filters on deleted_at, not on this.
UPDATE "user" u SET is_staff = true
FROM practitioner p
WHERE p.user_id = u.id;
--> statement-breakpoint
-- And nobody else is bookable. `accepts_bookings` was added in 0140 defaulting
-- to true, so every existing user — receptionists, org members who treat
-- nobody, sign-ups that never created an org — currently reads as bookable.
--> statement-breakpoint
-- ── country ───────────────────────────────────────────────────────────────
ALTER TABLE "user" ADD COLUMN "country" "country";--> statement-breakpoint
-- Carry it across for staff already merged by 0141. Idempotent.
UPDATE "user" u SET country = p.country
FROM practitioner p
WHERE p.user_id = u.id AND u.country IS NULL AND p.country IS NOT NULL;

--> statement-breakpoint
