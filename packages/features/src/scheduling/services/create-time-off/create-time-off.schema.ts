import { createTimeOffRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the wire contract — see
 * `packages/contracts/src/requests/scheduling.ts`. `practitionerId` stays a
 * BODY field here (there is no practitioner route param on `POST /time-off`),
 * so it is in the contract, not in this extension.
 */
export const createTimeOffBaseSchema = createTimeOffRequestBase.extend({
  organizationId: z.string().min(1),
  createdById: z.string().min(1),
  /**
   * Branch this time off applies to. Server-injected from the validated
   * `X-Location-Id` header. NULL/absent means "all branches" — that is a
   * supported, permanent state on this table, not a missing value.
   */
  locationId: z.string().min(1).optional(),
});

export const createTimeOffSchema = createTimeOffBaseSchema.refine(
  (d) => d.endDate > d.startDate,
  { message: 'endDate must be after startDate', path: ['endDate'] }
);

export type CreateTimeOffInput = z.infer<typeof createTimeOffSchema>;
