import { z } from 'zod';

/**
 * List videos input schema
 */
export const listVideosSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export type ListVideosInput = z.infer<typeof listVideosSchema>;
