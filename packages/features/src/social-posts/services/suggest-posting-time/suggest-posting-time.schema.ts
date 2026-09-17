import { z } from 'zod';

export const suggestPostingTimeSchema = z.object({
  organizationId: z.string().min(1),
  platform: z.enum(['facebook', 'instagram']).optional(),
});

export type SuggestPostingTimeInput = z.infer<typeof suggestPostingTimeSchema>;
