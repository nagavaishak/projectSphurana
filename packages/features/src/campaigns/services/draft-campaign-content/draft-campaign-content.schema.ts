import { z } from 'zod';
import { campaignChannelZ } from '../create-campaign/create-campaign.schema.js';

/**
 * Input for AI-drafted campaign copy. `prompt` is the marketer's free-text
 * brief ("promote our 20% off summer facial"); `businessName` is optional
 * context so the copy can name the clinic.
 */
export const draftCampaignContentSchema = z.object({
  organizationId: z.string().min(1),
  channel: campaignChannelZ,
  prompt: z.string().min(1, 'Describe what the campaign is about').max(1000),
  businessName: z.string().max(200).optional(),
});

export type DraftCampaignContentInput = z.infer<
  typeof draftCampaignContentSchema
>;

/**
 * Drafted copy. `subject` is only present for the email channel; sms/whatsapp
 * return body only.
 */
export interface DraftedCampaignContent {
  subject?: string;
  body: string;
}
