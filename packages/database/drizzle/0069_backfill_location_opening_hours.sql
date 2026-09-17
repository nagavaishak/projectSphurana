-- Custom SQL migration file, put your code below! --

-- ============================================================================
-- Availability consolidation — backfill organization.business_hours →
-- organization_location.opening_hours
-- ============================================================================
-- Opening hours are being consolidated onto the location (Fresha-style: per-
-- location hours + staff shifts). Historically every org set org-level
-- business_hours (universally populated) while location opening_hours went
-- unused. This copies each org's business_hours into any location that has no
-- opening_hours yet, so the location becomes the populated single source of
-- truth before the org-level "Availability" editor is retired.
--
-- business_hours and opening_hours share the same JSON shape
-- (Record<dayOfWeek, { from, to }>), so this is a direct copy.
--
-- Idempotent: only fills locations whose opening_hours IS NULL; re-running is a
-- no-op. Non-destructive: never overwrites a location that already has hours.
-- ============================================================================

UPDATE organization_location AS ol
SET opening_hours = o.business_hours
FROM organization AS o
WHERE ol.organization_id = o.id
  AND ol.opening_hours IS NULL
  AND o.business_hours IS NOT NULL;
