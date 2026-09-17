import { updateTimeOffRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the wire contract — see
 * `packages/contracts/src/requests/scheduling.ts`. `id` is the route param.
 */
export const updateTimeOffBaseSchema = updateTimeOffRequestBase.extend({
  id: z.string().min(1),
  organizationId: z.string().min(1),
});

export const updateTimeOffSchema = updateTimeOffBaseSchema.refine(
  (d) => !(d.startDate && d.endDate) || d.endDate > d.startDate,
  { message: 'endDate must be after startDate', path: ['endDate'] }
);

export type UpdateTimeOffInput = z.infer<typeof updateTimeOffSchema>;
