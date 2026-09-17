import { z } from 'zod';

export const listCampaignsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  status: z
    .enum([
      'draft',
      'scheduled',
      'sending',
      'paused',
      'sent',
      'failed',
      'cancelled',
    ])
    .optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export type ListCampaignsInput = z.infer<typeof listCampaignsSchema>;
