import { z } from 'zod';

export const addMetaAdsPageSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  pageId: z.string().min(1, 'Page ID is required'),
  pageName: z.string().optional(),
  pageAccessToken: z.string().min(1, 'Page access token is required'),
  platform: z.enum(['facebook', 'instagram']),
  pixelId: z.string().optional(),
  pixelName: z.string().optional(),
  setAsDefault: z.boolean().default(false),
});

export type AddMetaAdsPageInput = z.infer<typeof addMetaAdsPageSchema>;
