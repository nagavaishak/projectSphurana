import { z } from 'zod';

export const getPostEngagementSchema = z.object({
  socialPostId: z.string().min(1, 'Social post ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  platform: z.enum(['facebook', 'instagram']).optional(),
});

export type GetPostEngagementInput = z.infer<typeof getPostEngagementSchema>;
