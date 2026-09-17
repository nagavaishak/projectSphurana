import { z } from 'zod';

export const listCampaignConversationIntentsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  metaCampaignId: z.string().min(1, 'Campaign ID is required'),
  /** When set, only conversations active within the last N days. */
  withinDays: z.number().int().positive().max(365).optional(),
});

export type ListCampaignConversationIntentsInput = z.infer<
  typeof listCampaignConversationIntentsSchema
>;

export interface CampaignConversationIntentRow {
  conversationId: string;
  stage: string | null;
  bookingInterest: boolean;
  userMessageCount: number;
  lastActivityAt: string | null;
  isHighIntent: boolean;
  reasons: string[];
}

export interface CampaignConversationIntents {
  metaCampaignId: string;
  total: number;
  highIntentCount: number;
  lowIntentCount: number;
  conversations: CampaignConversationIntentRow[];
}
