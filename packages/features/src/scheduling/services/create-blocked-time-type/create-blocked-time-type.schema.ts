import { createBlockedTimeTypeRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the wire contract — see
 * `packages/contracts/src/requests/scheduling.ts`.
 */
export const createBlockedTimeTypeSchema =
  createBlockedTimeTypeRequestBase.extend({
    organizationId: z.string().min(1),
  });

export type CreateBlockedTimeTypeInput = z.infer<
  typeof createBlockedTimeTypeSchema
>;
