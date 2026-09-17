import { z } from 'zod';

export const primeStockRotationSchema = z.object({
  organizationId: z.string().min(1),
  serviceId: z.string().min(1),
  /** Owner of the minted asset rows. */
  uploadedById: z.string().min(1),
  /**
   * How many matched stock clips to admit to this service's pool.
   *
   * This is a POOL SIZE, not a request for footage — it bounds how much stock
   * a service can ever rotate through. Small on purpose: the pool exists to
   * break repetition, and admitting the whole bank would bury the owner's own
   * media under stock that merely matches the vertical.
   */
  count: z.number().int().min(1).max(20).default(4),
  /** Restrict the admitted clips to one media type. */
  mediaType: z.enum(['image', 'video']).optional(),
  /** Override the vertical; otherwise derived from the org's business type. */
  vertical: z.string().nullish(),
});

export type PrimeStockRotationInput = z.input<typeof primeStockRotationSchema>;
