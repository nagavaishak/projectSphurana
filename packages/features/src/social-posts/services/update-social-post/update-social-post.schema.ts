import { updateSocialPostRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for updating a social post.
 *
 * DERIVED from the canonical wire contract (`updateSocialPostRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected context
 * fields onto it. The server schema is therefore the wire schema PLUS fields —
 * it can never be laxer than what the client is told to send. Field rules
 * (`.min(1)`, `.url()`, the narrowed `status` enum) live in the contract; do
 * not restate them here.
 */
export const updateSocialPostSchema = updateSocialPostRequestBase.extend({
  id: z.string().min(1, 'Social post ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

/**
 * Input type inferred from schema
 */
export type UpdateSocialPostInput = z.infer<typeof updateSocialPostSchema>;
