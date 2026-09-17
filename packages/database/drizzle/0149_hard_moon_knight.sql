ALTER TABLE "meta_ads_page" ADD COLUMN "last_lead_poll_at" timestamp;--> statement-breakpoint
ALTER TABLE "meta_ads_page" ADD COLUMN "lead_form_counts" jsonb;--> statement-breakpoint
-- Seed every EXISTING page's cursor to deploy time.
--
-- A null cursor means "backfill 90 days", so without this the first scheduler
-- tick after deploy would pull ~1,355 historical leads across every connected
-- page at once (ENG-786) — a large uncontrolled write, plus lead-created
-- notifications, as a side effect of shipping.
--
-- Seeded, the poll starts as a no-op and only picks up NEW leads. Recovering
-- the historical ones is then a deliberate, per-organization action: set the
-- cursor back for one org and let the next tick reconcile it.
UPDATE "meta_ads_page" SET "last_lead_poll_at" = now() WHERE "last_lead_poll_at" IS NULL;
