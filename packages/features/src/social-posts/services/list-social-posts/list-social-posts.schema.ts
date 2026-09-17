import { z } from 'zod';

/**
 * Schema for listing social posts
 */
export const listSocialPostsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),

  // Filters
  status: z
    .enum([
      'draft',
      'scheduled',
      'publishing',
      'published',
      'partial',
      'failed',
    ])
    .optional(),
  platform: z.enum(['facebook', 'instagram']).optional(),
  mediaType: z.enum(['image', 'video']).optional(),

  // Date range filters (for calendar view)
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),

  // Search by title
  search: z.string().optional(),

  // Pagination
  limit: z.coerce.number().min(1).max(500).default(50),
  offset: z.coerce.number().min(0).default(0),
});

/**
 * Input type inferred from schema
 */
export type ListSocialPostsInput = z.infer<typeof listSocialPostsSchema>;
