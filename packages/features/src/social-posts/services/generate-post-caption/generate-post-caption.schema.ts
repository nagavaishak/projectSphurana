import { z } from 'zod';
import { videoIdeaSchema } from '../../../videos/services/generate-video-idea/index.js';

/**
 * Input for `generatePostCaption`. Mirrors the planner doc P3c shape:
 *
 *   { organizationId, idea: VideoIdea, brandVoice? }
 *
 * The `idea` is reused verbatim from `videoIdeaSchema` (P3a) so the shape can
 * never drift between the on-screen video copy and the long-form caption that
 * are both derived from the same blob.
 */
export const generatePostCaptionSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  idea: videoIdeaSchema,
  brandVoice: z.string().max(500).optional(),
});

export type GeneratePostCaptionInput = z.infer<
  typeof generatePostCaptionSchema
>;

/**
 * Output schema. The caption is a single string (hook + body + CTA + 3-5
 * hashtags).
 *
 * THE UPPER BOUND WAS TOO TIGHT AND SILENTLY COST WHOLE VIDEOS. At 500 the
 * model overshot on every failure observed — 540, 567, 678, 680, 702, 719 and
 * 758 characters, never once short — and a schema failure here is fatal to the
 * item: `dispatchMonthlyPlan` drops the planned video, so one org lost all
 * three of its videos for the month because the words that go in the post
 * description ran long. The video was planned, its b-roll resolved and its
 * render ready.
 *
 * 1200 is chosen from what the model actually writes plus headroom, not from a
 * platform limit: Instagram allows 2200 and every caption column in the
 * database is unbounded `text`, so 500 was ours alone and enforced nothing.
 * The floor stays at 80 — it has never been hit, and a one-line caption is a
 * genuine defect rather than a style choice.
 */
export const postCaptionOutputSchema = z.object({
  caption: z.string().min(80).max(1200),
});

export type GeneratedPostCaption = z.infer<typeof postCaptionOutputSchema>;
