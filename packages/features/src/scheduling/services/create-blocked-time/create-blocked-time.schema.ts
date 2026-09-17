import { createBlockedTimeRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the wire contract — see
 * `packages/contracts/src/requests/scheduling.ts`.
 *
 * The body shape lives there; this file only adds the fields the CONTROLLER
 * injects, so the server schema can never be laxer than the wire schema and
 * drift is structurally impossible. Do not re-declare body fields here.
 */
export const createBlockedTimeBaseSchema = createBlockedTimeRequestBase.extend({
  organizationId: z.string().min(1),
  createdById: z.string().min(1),
  /**
   * Branch this block applies to. Server-injected from the validated
   * `X-Location-Id` header. NULL/absent means "all branches" — that is a
   * supported, permanent state on this table, not a missing value.
   */
  locationId: z.string().min(1).optional(),
});

export const createBlockedTimeSchema = createBlockedTimeBaseSchema.refine(
  (d) => d.endDate > d.startDate,
  { message: 'endDate must be after startDate', path: ['endDate'] }
);

export type CreateBlockedTimeInput = z.infer<typeof createBlockedTimeSchema>;
