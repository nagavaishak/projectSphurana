import { previewSegmentRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the wire contract — see `packages/contracts/src/requests/
 * campaigns.ts`.
 */
export const previewSegmentSchema = previewSegmentRequestBase.extend({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type PreviewSegmentInput = z.infer<typeof previewSegmentSchema>;
