import { updateFaceGroupRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for correcting a face group (rename / retag).
 *
 * DERIVED from the canonical wire contract (`updateFaceGroupRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected context
 * fields onto it. Field rules live in the contract; do not restate them here.
 */
export const updateFaceGroupSchema = updateFaceGroupRequestBase.extend({
  id: z.string().min(1),
  organizationId: z.string().min(1),
});

export type UpdateFaceGroupInput = z.infer<typeof updateFaceGroupSchema>;
