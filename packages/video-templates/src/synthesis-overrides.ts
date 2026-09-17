// SynthesisOverrides — the per-video "frozen content" envelope written by
// wave-7's v1→v2 backfill into the `video.synthesis_overrides` column.
//
// Each field is independently optional. Re-renders read whatever's present
// and skip the corresponding synthesis step:
//   - frozenScript present       → phase-a-script skips the Claude call and
//                                   uses these role buckets verbatim
//   - frozenOfferContent present → the compiler applies these to info-card
//                                   slots (headline/items/price/cta/currency)
//                                   before query resolution, so the v1 offer
//                                   card replays exactly
//   - pinnedAssets present       → the compiler uses these asset IDs to
//                                   satisfy the asset-media / music slots
//                                   instead of letting the gate re-pick
//   - themeOverrides present     → merged into the per-video override layer
//                                   of the resolution cascade (engine →
//                                   brand_kit → theseOverrides)
//
// The full design lives in docs/plans/video-template-engine-remaining.md
// (wave 7 brief).

import { z } from 'zod';
import { type ThemeOverrides, themeOverridesSchema } from './theme.js';

export const synthesisOverridesFrozenScriptSchema = z
  .object({
    hook: z.string().optional(),
    body: z.array(z.string()).optional(),
    cta: z.string().optional(),
    disclaimer: z.string().optional(),
  })
  .strict();

export type SynthesisOverridesFrozenScript = z.infer<
  typeof synthesisOverridesFrozenScriptSchema
>;

export const synthesisOverridesFrozenOfferContentSchema = z
  .object({
    headline: z.string().optional(),
    items: z.array(z.string()).optional(),
    /** Decimal-formatted price string, e.g. '155.00'. */
    price: z.string().optional(),
    /** Currency code or symbol — preserves v1 raw value for lossless replay. */
    currency: z.string().optional(),
    cta: z.string().optional(),
  })
  .strict();

export type SynthesisOverridesFrozenOfferContent = z.infer<
  typeof synthesisOverridesFrozenOfferContentSchema
>;

export const synthesisOverridesPinnedAssetsSchema = z
  .object({
    beforeAssetId: z.string().optional(),
    afterAssetId: z.string().optional(),
    musicTrackId: z.string().optional(),
    /** TTS voice the user picked on the original v1 video. */
    voice: z.string().optional(),
  })
  .strict();

export type SynthesisOverridesPinnedAssets = z.infer<
  typeof synthesisOverridesPinnedAssetsSchema
>;

export interface SynthesisOverrides {
  themeOverrides?: ThemeOverrides;
  frozenScript?: SynthesisOverridesFrozenScript;
  frozenOfferContent?: SynthesisOverridesFrozenOfferContent;
  pinnedAssets?: SynthesisOverridesPinnedAssets;
}

// Runtime validator. Used by phase-a inputs + the wave-7 backfill writer.
export const synthesisOverridesSchema: z.ZodType<SynthesisOverrides> = z
  .object({
    themeOverrides: themeOverridesSchema.optional(),
    frozenScript: synthesisOverridesFrozenScriptSchema.optional(),
    frozenOfferContent: synthesisOverridesFrozenOfferContentSchema.optional(),
    pinnedAssets: synthesisOverridesPinnedAssetsSchema.optional(),
  })
  .strict();
