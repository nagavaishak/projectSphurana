-- Custom SQL migration file, put your code below! --
--
-- Backfill conversation.lead_id (added in 0142) from the strongest available
-- signal, so the Clients "unread inbound message" sort tier catches every
-- linkable conversation instead of only the sparse metadata.leadId cases.
-- Idempotent and re-runnable: every UPDATE is guarded on lead_id IS NULL.
-- Runs as the migration role, which bypasses RLS.

-- 1. The legacy pointer: conversations already linked via metadata.leadId.
--    Guarded by an existence check so a pointer to a deleted lead is skipped
--    (the FK would otherwise reject the update).
UPDATE "conversation" c
SET "lead_id" = c."metadata" ->> 'leadId'
WHERE c."lead_id" IS NULL
  AND c."metadata" ->> 'leadId' IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "lead" l
    WHERE l."id" = c."metadata" ->> 'leadId'
      AND l."organization_id" = c."organization_id"
  );
--> statement-breakpoint

-- 2. Messenger / Instagram: the conversation's external_user_id is the sender's
--    PSID/IGSID, which we also store on the lead (lead.psid) for chat-originated
--    leads. Match within the same org.
UPDATE "conversation" c
SET "lead_id" = l."id"
FROM "lead" l
WHERE c."lead_id" IS NULL
  AND l."organization_id" = c."organization_id"
  AND l."psid" IS NOT NULL
  AND l."psid" <> ''
  AND c."external_user_id" = l."psid";
--> statement-breakpoint

-- 3. WhatsApp: external_user_id is the sender's WhatsApp number. Match it to the
--    lead's whatsapp (or phone) on digits only, so "+353 …" and "353…" agree.
UPDATE "conversation" c
SET "lead_id" = l."id"
FROM "lead" l
WHERE c."lead_id" IS NULL
  AND c."platform" = 'whatsapp'
  AND l."organization_id" = c."organization_id"
  AND regexp_replace(COALESCE(NULLIF(l."whatsapp", ''), l."phone", ''), '\D', '', 'g') <> ''
  AND regexp_replace(c."external_user_id", '\D', '', 'g')
      = regexp_replace(COALESCE(NULLIF(l."whatsapp", ''), l."phone", ''), '\D', '', 'g');
