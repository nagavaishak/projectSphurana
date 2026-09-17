import { updateBlockedTimeTypeRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the wire contract — see
 * `packages/contracts/src/requests/scheduling.ts`. `id` is the route param.
 */
export const updateBlockedTimeTypeSchema =
  updateBlockedTimeTypeRequestBase.extend({
    id: z.string().min(1),
    organizationId: z.string().min(1),
  });

export type UpdateBlockedTimeTypeInput = z.infer<
  typeof updateBlockedTimeTypeSchema
>;
