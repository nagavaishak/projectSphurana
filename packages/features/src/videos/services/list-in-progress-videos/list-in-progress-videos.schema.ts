import { z } from 'zod';

/**
 * List in-progress videos input schema
 */
export const listInProgressVideosSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type ListInProgressVideosInput = z.infer<
  typeof listInProgressVideosSchema
>;
