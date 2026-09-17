-- ============================================================================
-- One portal membership per person per clinic, and one account per email.
-- ============================================================================
-- Hand-edited preamble. Both constraints below would ABORT on data that
-- already violates them, and both classes of violation are ones the code
-- could previously produce, so the offending rows are collapsed first.
--
-- WHY (patient_auth). `lead_id` was unique, which sounds like "one membership
-- per person" and is not: duplicate LEAD rows for the same person are the
-- normal state of a CRM — they book online, then phone, then arrive as a
-- walk-in, and Meta lead ads add a fourth. Each grew its own membership, and
-- `resolvePatientPrincipal` then chose between them with an unordered
-- findFirst, so the customer's bookings appeared and disappeared between page
-- loads. Two family members sharing one email address at the same clinic
-- could be shown each other's records.
--
-- WHY (customer_account). The existing UNIQUE on `email` is case-SENSITIVE,
-- so `Jo@x.com` and `jo@x.com` are two universal identities for one person.
-- Lowercase storage was enforced only by application code — one path missing
-- `.toLowerCase()` and the customer signs in to find a different set of
-- clinics, with their consent history invisible. A functional unique index
-- makes that impossible instead of merely unlikely.
--
-- Data note: prod has never run the portal, so these DELETEs touch nothing
-- there. On preview/staging they collapse QA rows. Leads, appointments and
-- consent submissions are NOT touched — only the portal identity rows.
-- ============================================================================

-- patient_auth: keep the OLDEST membership per (account, org). Oldest, not
-- newest, because it is the one whose lead has accumulated the history.
DELETE FROM "patient_auth" a
 USING "patient_auth" b
 WHERE a."customer_account_id" = b."customer_account_id"
   AND a."organization_id" = b."organization_id"
   AND (a."created_at", a."id") > (b."created_at", b."id");
--> statement-breakpoint

-- customer_account: collapse case-variant duplicates, keeping the oldest.
-- CASCADE removes their memberships and sessions; the person simply signs in
-- again and lands on the surviving account.
DELETE FROM "customer_account" a
 USING "customer_account" b
 WHERE lower(a."email") = lower(b."email")
   AND (a."created_at", a."id") > (b."created_at", b."id");
--> statement-breakpoint

UPDATE "customer_account"
   SET "email" = lower("email")
 WHERE "email" <> lower("email");
--> statement-breakpoint

ALTER TABLE "patient_auth" ADD CONSTRAINT "uq_patient_auth_account_org" UNIQUE("customer_account_id","organization_id");--> statement-breakpoint

-- Functional unique index: `email` already has a plain UNIQUE, which this
-- deliberately duplicates in the case-insensitive direction rather than
-- replaces — the plain one still catches exact duplicates on write.
CREATE UNIQUE INDEX "uq_customer_account_email_lower" ON "customer_account" (lower("email"));
