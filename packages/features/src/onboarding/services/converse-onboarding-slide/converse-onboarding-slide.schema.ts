import { z } from 'zod';
import type { OnboardingSlideResponse } from '../../models/index.js';

/**
 * The two conversational slides in the onboarding deck. Free-text on any
 * other slide never reaches Claire — buttons/inputs are recorded directly
 * via `update-onboarding-session`.
 */
export const conversationalSlideValues = [
  'campaign_pitch',
  'intro_offer',
] as const;

export type ConversationalSlide = (typeof conversationalSlideValues)[number];

/**
 * Input for `converseOnboardingSlide` — the user typed free text on a
 * conversational slide and Claire must answer with a STRUCTURED slide
 * (headline + options + optional input), never prose.
 */
export const converseOnboardingSlideSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  slide: z.enum(conversationalSlideValues),
  userText: z
    .string()
    .min(1, 'User text is required')
    .max(2000, 'User text is too long'),
});

export type ConverseOnboardingSlideInput = z.infer<
  typeof converseOnboardingSlideSchema
>;

export interface ConverseOnboardingSlideOutput {
  slide: ConversationalSlide;
  /** The structured slide Claire responds with — never free-form prose. */
  response: OnboardingSlideResponse;
  /**
   * `true` when the AI round-trip failed (parse/validation error) and the
   * safe "let's try that again" slide was returned instead of erroring.
   */
  fallback: boolean;
}
