/**
 * Domain types for the Claire-guided Typeform-style onboarding flow.
 * See docs/plans/claire-onboarding.md.
 */
import { z } from 'zod';

// Re-export database types
export type {
  OnboardingSession,
  NewOnboardingSession,
  OnboardingConversationTurn,
  OnboardingStagedCampaign,
} from '@borradh-workspace/database';
export type {
  OnboardingSlide,
  OnboardingSessionStatus,
  OnboardingContentSource,
} from '@borradh-workspace/labels';

/**
 * The structured slide Claire responds with on conversational slides.
 * Free-text user input round-trips through Claire but ALWAYS renders back
 * as this shape — a headline plus buttons and/or one input, never prose.
 */
export const onboardingSlideResponseSchema = z.object({
  headline: z.string().min(1),
  description: z.string().optional(),
  options: z
    .array(
      z.object({
        label: z.string().min(1),
        value: z.string().min(1),
      })
    )
    .min(1)
    .max(4),
  input: z.enum(['text', 'price']).nullable().optional(),
});

export type OnboardingSlideResponse = z.infer<
  typeof onboardingSlideResponseSchema
>;
