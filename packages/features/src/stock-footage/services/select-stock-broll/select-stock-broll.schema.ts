import { z } from 'zod';

/**
 * Input for the render-time selector. Produces a bRollClips list to auto-fill a
 * video that has a service but no uploaded footage. Service-specific matches
 * come first (from service_stock_clip), topped up from the generic pool.
 */
export const selectStockBRollSchema = z.object({
  organizationId: z.string().min(1),
  serviceId: z.string().min(1).optional().nullable(),
  // Becomes the minted assets' uploadedById (the acting user).
  uploadedById: z.string().min(1),
  // Number of b-roll clips to produce.
  count: z.number().int().positive().max(20).default(5),
  // Override the vertical; otherwise derived from the org's business type.
  vertical: z.string().optional(),
  /**
   * What the owner asked for, in their words — "something with the treatment
   * room in it". Ranks the resolved pool by description overlap before minting.
   *
   * Absent at render time, where nobody has described anything and the bank's
   * own service ranking is the best signal there is.
   */
  query: z.string().max(280).optional(),
});

// z.input so callers may omit defaulted fields (count, vertical); the impl
// parses to fill defaults.
export type SelectStockBRollInput = z.input<typeof selectStockBRollSchema>;
