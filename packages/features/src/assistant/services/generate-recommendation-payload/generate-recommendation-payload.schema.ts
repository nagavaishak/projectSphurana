import { assistantRecommendationKindValues } from '@borradh-workspace/database';
import { z } from 'zod';

export const generateRecommendationPayloadSchema = z.object({
  organizationId: z.string().min(1),
  kind: z.enum(assistantRecommendationKindValues),
  // Optional structured data the trigger has already computed (e.g. campaign
  // name, current vs prior CPL, frequency, lead counts). The prompt builder
  // renders it into the user prompt for the kinds that consume it. Kept
  // permissive (`Record<string, unknown>`) so individual triggers can pass
  // whatever shape fits — `prompts.ts` is the source of truth for which
  // fields each kind expects.
  triggerContext: z.record(z.string(), z.unknown()).optional(),
});

export type GenerateRecommendationPayloadInput = z.infer<
  typeof generateRecommendationPayloadSchema
>;

// The JSON shape the LLM must return (and that we validate against).
export const generatedPayloadSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(500),
  suggestedCampaignName: z.string().min(1).max(100).optional(),
  suggestedService: z.string().min(1).max(100).optional(),
  suggestedPrice: z.string().min(1).max(50).optional(),
  suggestedPainPoint: z.string().min(1).max(200).optional(),
  campaignAngle: z.string().min(1).max(200).optional(),
});

export type GeneratedPayload = z.infer<typeof generatedPayloadSchema>;
