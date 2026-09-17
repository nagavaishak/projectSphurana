import { z } from 'zod';

/**
 * Inspect a single conversation's attribution + high-intent classification.
 * Look up by `conversationId`, or by `(organizationId, platform,
 * externalUserId)` — the latter is handy for verifying a click-to-WhatsApp
 * conversation live: send a CTWA message from a phone, then look it up by that
 * WhatsApp number to confirm `adMetaId` landed and see the intent verdict.
 */
export const inspectConversationIntentSchema = z
  .object({
    conversationId: z.string().min(1).optional(),
    organizationId: z.string().min(1).optional(),
    platform: z
      .enum(['facebook_messenger', 'instagram_dm', 'whatsapp'])
      .optional(),
    externalUserId: z.string().min(1).optional(),
  })
  .refine(
    (v) =>
      Boolean(v.conversationId) ||
      Boolean(v.organizationId && v.platform && v.externalUserId),
    {
      message:
        'Provide either conversationId, or organizationId + platform + externalUserId',
    }
  );

export type InspectConversationIntentInput = z.infer<
  typeof inspectConversationIntentSchema
>;

export interface ConversationIntentReport {
  conversationId: string;
  organizationId: string;
  platform: string;
  externalUserId: string;
  externalUserName: string | null;
  // Attribution (CTWA / click-to-message). Populated when the conversation
  // started from an ad. `adMetaId` joins to `metaAd.metaAdId` →
  // `metaAd.metaCampaignId`.
  attribution: {
    adMetaId: string | null;
    adInternalId: string | null;
    adTitle: string | null;
    attributed: boolean;
  };
  // Intent classification (shared predicate).
  stage: string | null;
  bookingInterest: boolean;
  userMessageCount: number;
  isHighIntent: boolean;
  reasons: string[];
}
