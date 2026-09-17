import { z } from 'zod';

export const embedVoiceExamplesSchema = z.object({
  organizationId: z.string().min(1),
  metaAdsPageId: z.string().min(1),
  messagePairs: z.array(
    z.object({
      customerMessage: z.string(),
      businessReply: z.string(),
      timestamp: z.date().optional(),
      conversationId: z.string().optional(),
    })
  ),
});

export type EmbedVoiceExamplesInput = z.infer<typeof embedVoiceExamplesSchema>;
