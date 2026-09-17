// convertBeforeAfter — pure function from a v1 before-after draftConfig to the
// v2 (TemplateDoc, brandFieldsForTheme, themeOverridesForVideo) bundle.
//
// Switches on variationId across before-after-1/2/3. The three Shape-C
// templates share structure (env spine + BEFORE PiP + interstitial text +
// AFTER full-bleed reveal + outro info-card) but differ in animation tokens,
// timing, and layout — see the individual TemplateDoc files for the diffs.
//
// What this converter maps:
//   v1 bRollClips[clipType: 'before']  →  pinned per-video as
//                                         themeOverridesForVideo.pinnedAssets.beforeAssetId
//                                         so wave 7 can replay the exact asset.
//                                         NOT baked into TemplateDoc — the
//                                         template's BEFORE PiP slot stays a
//                                         query (`asset-media tag=before`) so
//                                         the gate can satisfy it from the org
//                                         library when replaying from scratch.
//   v1 bRollClips[clipType: 'after']   →  same pattern, pinnedAssets.afterAssetId
//   v1 bRollClips[clipType: 'bRoll']   →  Phase-A picks fill the env spine slot
//                                         (asset-clips tag=procedure). Not
//                                         pinned — the spine reads whatever
//                                         procedure clips the org has, since
//                                         most v1 before-after videos used
//                                         generic environment footage.
//   v1 musicTrackId                    →  themeOverridesForVideo.pinnedMusic.trackId
//                                         when present.
//   v1 outro.businessName              →  brandFieldsForTheme.identity.businessName
//   v1 outro.logoUrl                   →  brandFieldsForTheme.logo.light
//   v1 outro.ctaText                   →  brandFieldsForTheme.identity.ctaText
//   v1 outro.backgroundColor / textColor → brandFieldsForTheme.colors.{primary,onPrimary}
//                                         (same cascade rule as authority-1:
//                                         brand colours, fall through if
//                                         missing).
//
// What this converter doesn't carry:
//   v1 scriptText — Shape C carries no narration and no script-text slots, so
//   the v1 scriptText (e.g. "Check out this transformation...") simply
//   doesn't have a home on v2. The visual reveal IS the message. If product
//   wants the v1 caption-style text overlay, the v2 path is to add an extra
//   `text` overlay block to the template — a template authoring decision, not
//   a per-video override.
//
//   v1 captions config — Shape C has no captions block. v1 captions were tied
//   to talking-head audio (narrationType !== 'text_only'); before-after was
//   `text_only`, so captions never rendered. No-op on conversion.

import type {
  BRollClipConfig,
  VideoDraftConfig,
} from '@borradh-workspace/database';
import type { TemplateDoc } from '@borradh-workspace/video-templates';

// Subpath imports rather than the barrel — the wave-6 integrator owns the
// barrel (`packages/video-templates/src/index.ts`); the subpaths are declared
// in this package's `package.json` exports and the workspace tsconfig paths.
// This matches the convention established by convert-authority-1.
import { beforeAfter1 } from '@borradh-workspace/video-templates/before-after-1';
import { beforeAfter2 } from '@borradh-workspace/video-templates/before-after-2';
import { beforeAfter3 } from '@borradh-workspace/video-templates/before-after-3';

import type {
  BrandFieldsForTheme,
  ThemeOverridesForVideo,
} from '../converter-types.js';

export type BeforeAfterVariationId =
  | 'before-after-1'
  | 'before-after-2'
  | 'before-after-3';

/**
 * Extended ThemeOverrides with the converter-only side channels for per-video
 * pinning. Wave 7's compiler reads these to satisfy the asset-media (before /
 * after) and music slots with the exact v1 selections, preserving the
 * fidelity replay invariant.
 *
 * These fields don't live on the canonical ThemeOverrides type (theme.ts)
 * because they're not "theme" data — they're per-video synthesis hints. The
 * converter contract carries them alongside theme overrides since both are
 * "per-video extras that don't fit in the TemplateDoc".
 */
export interface BeforeAfterThemeOverridesForVideo
  extends ThemeOverridesForVideo {
  /** Pinned asset selections for the BEFORE / AFTER slots. */
  pinnedAssets?: {
    beforeAssetId?: string;
    afterAssetId?: string;
  };
  /** Pinned music track (trackId + volume) when v1 carried a specific pick. */
  pinnedMusic?: {
    trackId: string;
    volume: number;
  };
}

export interface BeforeAfterConversionResult {
  templateDoc: TemplateDoc;
  templateId: BeforeAfterVariationId;
  brandFieldsForTheme: BrandFieldsForTheme;
  themeOverridesForVideo: BeforeAfterThemeOverridesForVideo;
}

function hexish(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return /^#[0-9A-Fa-f]{3,8}$/.test(value) ? value : undefined;
}

function pickAssetId(
  clips: BRollClipConfig[] | undefined,
  clipType: 'before' | 'after'
): string | undefined {
  if (!clips) return undefined;
  const match = clips.find((c) => c.clipType === clipType);
  return match?.assetId;
}

function templateFor(variationId: BeforeAfterVariationId): TemplateDoc {
  switch (variationId) {
    case 'before-after-1':
      return beforeAfter1;
    case 'before-after-2':
      return beforeAfter2;
    case 'before-after-3':
      return beforeAfter3;
  }
}

export function convertBeforeAfter(
  variationId: BeforeAfterVariationId,
  draftConfig: VideoDraftConfig
): BeforeAfterConversionResult {
  const templateDoc = templateFor(variationId);

  const outro = draftConfig.outro;

  // ── brandFieldsForTheme ────────────────────────────────────────────
  // Same cascade rule as convert-authority-1: only fill a branch when v1 had
  // a real value; missing branches fall through to brand_kit / engineDefaults.
  const brandFieldsForTheme: BrandFieldsForTheme = {};

  const primary = hexish(outro?.backgroundColor);
  const onPrimary = hexish(outro?.textColor);
  if (primary || onPrimary) {
    brandFieldsForTheme.colors = {};
    if (primary) brandFieldsForTheme.colors.primary = primary;
    if (onPrimary) brandFieldsForTheme.colors.onPrimary = onPrimary;
  }

  if (outro?.logoUrl) {
    brandFieldsForTheme.logo = { light: outro.logoUrl };
  }

  const identity: BrandFieldsForTheme['identity'] = {};
  if (outro?.businessName) identity.businessName = outro.businessName;
  if (outro?.ctaText) identity.ctaText = outro.ctaText;
  if (Object.keys(identity).length > 0) {
    brandFieldsForTheme.identity = identity;
  }

  // ── themeOverridesForVideo (per-video pinning side channel) ───────
  const themeOverridesForVideo: BeforeAfterThemeOverridesForVideo = {};

  const beforeAssetId = pickAssetId(draftConfig.bRollClips, 'before');
  const afterAssetId = pickAssetId(draftConfig.bRollClips, 'after');
  if (beforeAssetId || afterAssetId) {
    themeOverridesForVideo.pinnedAssets = {};
    if (beforeAssetId) {
      themeOverridesForVideo.pinnedAssets.beforeAssetId = beforeAssetId;
    }
    if (afterAssetId) {
      themeOverridesForVideo.pinnedAssets.afterAssetId = afterAssetId;
    }
  }

  if (draftConfig.musicTrackId) {
    themeOverridesForVideo.pinnedMusic = {
      trackId: draftConfig.musicTrackId,
      volume: draftConfig.musicVolume,
    };
  }

  return {
    templateDoc,
    templateId: variationId,
    brandFieldsForTheme,
    themeOverridesForVideo,
  };
}

export type ConvertBeforeAfterResult = ReturnType<typeof convertBeforeAfter>;
