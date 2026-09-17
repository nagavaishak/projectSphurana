import {
  createVideoRequestBase,
  draftConfigSchema,
  offerCardDraftConfigSchema,
  partialDraftConfigSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * The draft-config schemas now live in the canonical wire contract
 * (`packages/contracts/src/requests/content.ts`) because three endpoints carry
 * them. They are re-exported here under their historical names so the video
 * worker, the template synthesiser and the assistant tools keep importing them
 * from `@borradh-workspace/features/videos`.
 */
export {
  draftConfigSchema,
  offerCardDraftConfigSchema,
  partialDraftConfigSchema,
};

export type DraftConfig = z.infer<typeof draftConfigSchema>;
export type PartialDraftConfig = z.infer<typeof partialDraftConfigSchema>;

/**
 * Known video format identifiers (mirror template IDs in
 * `videos/templates/template-definitions.ts`). Used by the partial-input
 * controller path to pick a sensible template when the caller doesn't supply
 * a `templateId`. Kept open at the value level (z.string()) for backwards
 * compat with bespoke template IDs, but the LLM-facing tool restricts to this
 * enum so Claire can't request a non-existent format.
 */
export const KNOWN_VIDEO_FORMATS = [
  'before_after',
  'authority',
  'educational',
  'offer',
  'testimonial',
  'talking_head',
  // Organic (social-first) formats. Snake_case aliases for the kebab-case
  // organic template IDs, mapped in `VIDEO_FORMAT_TO_TEMPLATE_ID` below.
  'caption_tease',
  'ins_outs',
  'question_cta',
  'improves',
  'highlight_caption',
  'curiosity_hook',
  'step_timer',
  'time_progress',
  'poll',
  'myth_fact',
  'versus',
  'price_reveal',
  'client_question',
  'come_with_me',
] as const;

export type KnownVideoFormat = (typeof KNOWN_VIDEO_FORMATS)[number];

/**
 * Map W3-facing format aliases to backend template IDs. The template
 * definitions use kebab-case (`before-after`); the LLM-facing format uses
 * snake_case (`before_after`) to play nicely with the schema enum.
 *
 * `testimonial` is currently disabled at the template level — we fall back
 * to `authority` (also a talking-head style) until testimonial templates ship.
 * `talking_head` is an alias for `authority`.
 *
 * Organic formats map 1:1 to their kebab-case organic template IDs.
 */
export const VIDEO_FORMAT_TO_TEMPLATE_ID: Record<KnownVideoFormat, string> = {
  before_after: 'before-after',
  authority: 'authority',
  educational: 'educational',
  offer: 'offer',
  testimonial: 'authority',
  talking_head: 'authority',
  caption_tease: 'caption-tease',
  ins_outs: 'ins-outs',
  question_cta: 'question-cta',
  improves: 'improves',
  highlight_caption: 'highlight-caption',
  curiosity_hook: 'curiosity-hook',
  step_timer: 'step-timer',
  time_progress: 'time-progress',
  poll: 'poll',
  myth_fact: 'myth-fact',
  versus: 'versus',
  price_reveal: 'price-reveal',
  client_question: 'client-question',
  come_with_me: 'come-with-me',
};

/**
 * Strict create-video input schema — requires the full `draftConfig`.
 * Used by the legacy wizard path and by the synthesize-then-create flow
 * (the controller assembles the full config first, then calls
 * `createVideo` with this shape).
 */
export const createVideoSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100),
  templateId: z.string().optional(),
  /** If provided, use this variation; otherwise randomly select one from the template */
  variationId: z.string().optional(),
  /** Optional link to an organization service this video is about */
  serviceId: z.string().optional(),
  /** Optional link to an offer used in this video */
  offerId: z.string().optional(),
  draftConfig: draftConfigSchema,
  organizationId: z.string().min(1, 'Organization ID is required'),
  createdById: z.string().min(1, 'Created by ID is required'),
  /**
   * Whether this video is intended for an ad or an organic social post.
   * Defaults to 'ad' at the service layer (not in the schema) so the
   * `z.infer` type stays truly optional for existing callers.
   */
  usageType: z.enum(['ad', 'organic']).optional(),
});

export type CreateVideoInput = z.infer<typeof createVideoSchema>;

/**
 * `POST /videos` partial-input schema.
 *
 * DERIVED from the canonical wire contract (`createVideoRequestBase` in
 * `@borradh-workspace/contracts`). It adds NO context fields — the controller
 * injects `organizationId` / `createdById` one level up, on
 * `createVideoFromRequestSchema` — so the server body IS the wire body. Field
 * rules and the two accepted shapes are documented on the contract.
 */
export const createVideoPartialSchema = createVideoRequestBase;

export type CreateVideoPartialInput = z.infer<typeof createVideoPartialSchema>;
