import { z } from 'zod';

export const fetchPageMessagesSchema = z.object({
  organizationId: z.string().min(1),
  metaAdsPageId: z.string().min(1),
});

export type FetchPageMessagesInput = z.infer<typeof fetchPageMessagesSchema>;
