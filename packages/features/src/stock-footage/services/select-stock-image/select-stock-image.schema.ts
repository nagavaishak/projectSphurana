import { z } from 'zod';

/**
 * Input for the image-generation slot selector. Returns a single curated stock
 * still for a service when the org has no uploaded photo. URL-only (no asset is
 * minted) — resolveSlotImage signs and uses the URL directly.
 */
export const selectStockImageSchema = z.object({
  organizationId: z.string().min(1),
  serviceId: z.string().min(1),
  /** stock_clip ids already used by earlier slots, to avoid repeats. */
  excludeStockClipIds: z.array(z.string()).optional(),
  /** Rotates the pick so e.g. carousel slides don't all get the same still. */
  rotationSeed: z.string().optional(),
  /** Override the vertical; otherwise derived from the org's business type. */
  vertical: z.string().optional(),
});

export type SelectStockImageInput = z.input<typeof selectStockImageSchema>;
