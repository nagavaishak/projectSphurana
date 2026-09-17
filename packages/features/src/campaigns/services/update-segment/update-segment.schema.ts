import { updateSegmentRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the wire contract — see `packages/contracts/src/requests/
 * campaigns.ts`.
 */
export const updateSegmentSchema = updateSegmentRequestBase.extend({
  organizationId: z.string().min(1, 'Organization ID is required'),
  id: z.string().min(1, 'Segment ID is required'),
});

export type UpdateSegmentInput = z.infer<typeof updateSegmentSchema>;
