import { offerStateValues } from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * Schema for listing offers.
 *
 * `state` replaces the old `isActive` boolean (Window 1 / 9 — offer state
 * enum). Callers that want only currently-running offers should pass
 * `state: 'active'`. Omit `state` to list every row regardless of state.
 */
export const listOffersSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  state: z.enum(offerStateValues).optional(),
  /**
   * Branch filter, from the validated `X-Location-Id` header. Zero join rows
   * means "available everywhere" — see `atLocationOrUnassigned`.
   */
  locationId: z.string().min(1).optional(),

  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type ListOffersInput = z.infer<typeof listOffersSchema>;
