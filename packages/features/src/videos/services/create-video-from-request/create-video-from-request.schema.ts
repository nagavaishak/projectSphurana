import { z } from 'zod';
import { createVideoPartialSchema } from '../create-video/index.js';

/**
 * `POST /videos` request, plus the caller context the controller used to inject
 * from decorators. Accepts BOTH shapes the endpoint has always accepted:
 *
 *   - a partial payload (`{ format }` / `{ templateId }`) → synthesised, or
 *   - a legacy wizard payload carrying a complete `draftConfig` → stored as-is.
 *
 * The discriminator lives in the service, not the schema, because "complete"
 * is decided by sniffing for four keys rather than by a version tag.
 */
export const createVideoFromRequestSchema = createVideoPartialSchema.extend({
  organizationId: z.string().min(1, 'Organization ID is required'),
  createdById: z.string().min(1, 'Created by ID is required'),
});

export type CreateVideoFromRequestInput = z.infer<
  typeof createVideoFromRequestSchema
>;
