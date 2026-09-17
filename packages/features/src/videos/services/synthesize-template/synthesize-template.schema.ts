import {
  synthesisOverridesSchema,
  themeOverridesSchema,
} from '@borradh-workspace/video-templates';
import { z } from 'zod';

export const synthesizeTemplateSchema = z.object({
  videoId: z.string().min(1),
  organizationId: z.string().min(1),
  serviceId: z.string().optional(),
  /**
   * Deterministic seed for synthesis. Same seed + same inputs ⇒ same
   * RenderDoc (same clip count, same clip picks, same music tie-break, same
   * Claude script when the model honours the seed). When omitted, the service
   * generates a fresh seed and persists it on the video row so future
   * re-synth calls can replay it. Must be a non-negative 32-bit integer.
   */
  seed: z.number().int().nonnegative().max(0x7fffffff).optional(),
  /**
   * Per-video Theme override. Sits at the tail of the resolution cascade
   * (engine defaults → org brand_kit → THIS) so a single video can
   * override colours, fonts, or identity without persisting a new brand_kit
   * row. Any branch omitted falls through to the brand_kit / engine default.
   */
  themeOverrides: themeOverridesSchema.optional(),
  /**
   * Frozen-content envelope produced by the v1→v2 backfill. When present,
   * synthesis honours it instead of generating fresh content:
   *   - synthesisOverrides.frozenScript bypasses the Claude call
   *   - synthesisOverrides.frozenOfferContent overrides info-card slot fills
   *   - synthesisOverrides.pinnedAssets picks specific asset ids over the gate's
   *     seeded query
   *   - synthesisOverrides.themeOverrides is merged with the caller's
   *     themeOverrides (caller wins on conflict)
   * Loaded from video.synthesis_overrides on the backfill path; usually omitted
   * for fresh-creation flows.
   */
  synthesisOverrides: synthesisOverridesSchema.optional(),
});

export type SynthesizeTemplateInput = z.infer<typeof synthesizeTemplateSchema>;
