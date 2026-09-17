import { createSegmentRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the wire contract — see `packages/contracts/src/requests/
 * campaigns.ts`.
 */
export const createSegmentSchema = createSegmentRequestBase.extend({
  organizationId: z.string().min(1, 'Organization ID is required'),
  createdById: z.string().optional(),
});

export type CreateSegmentInput = z.infer<typeof createSegmentSchema>;
