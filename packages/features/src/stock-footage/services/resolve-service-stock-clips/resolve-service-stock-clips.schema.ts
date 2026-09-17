import { z } from 'zod';

/**
 * Input for the once-per-service semantic matcher. Resolves which stock clips
 * best fit an organization_service and caches the ranked result in
 * service_stock_clip. Triggered on service create/update and via backfill.
 */
export const resolveServiceStockClipsSchema = z.object({
  organizationServiceId: z.string().min(1, 'organizationServiceId required'),
  // Max service-specific picks to persist (the selector tops up to the
  // template's slot count from the generic pool).
  limit: z.number().int().positive().max(20).default(5),
  // Override the vertical; otherwise derived from the org's business type.
  vertical: z.string().optional(),
});

// z.input so callers may omit defaulted fields (limit, vertical); the impl
// parses to fill defaults.
export type ResolveServiceStockClipsInput = z.input<
  typeof resolveServiceStockClipsSchema
>;
