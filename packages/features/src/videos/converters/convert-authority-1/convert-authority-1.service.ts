// convertAuthority1 — pure function from a v1 authority-1 draftConfig to the
// v2 (TemplateDoc, brandFieldsForTheme) pair.
//
// What it maps:
//   v1 talkingHeadAssetId / Url    →  becomes a Phase-A picked clip at synth
//                                     time (not baked into the TemplateDoc)
//   v1 bRollClips                  →  becomes Phase-A picks for the cutaway
//                                     slots (not baked into TemplateDoc)
//   v1 outro.businessName          →  brandFieldsForTheme.identity.businessName
//   v1 outro.logoUrl               →  brandFieldsForTheme.logo.light
//   v1 outro.backgroundColor       →  brandFieldsForTheme.colors.primary
//   v1 outro.textColor             →  brandFieldsForTheme.colors.onPrimary
//   v1 outro.ctaText               →  brandFieldsForTheme.identity.ctaText
//   v1 musicTrackId                →  NOT baked into TemplateDoc. A flagged
//                                     follow-up — see convert-authority-1.test
//                                     and the comment in the body below.
//
// What it doesn't carry:
//   v1 `scriptText` — pre-rendered script text from v1. The v2 synthesis path
//   regenerates the script through Phase A's Claude call per the role/index
//   slot model; flat string text doesn't fit. If product later wants to honour
//   a hand-edited v1 script verbatim on the v2 path, the synth service grows a
//   `scriptOverride` knob; the converter doesn't make that decision today.

import type { VideoDraftConfig } from '@borradh-workspace/database';
import type { TemplateDoc } from '@borradh-workspace/video-templates';
// Import via the subpath export — the package root re-export is gated on the
// wave-6 integrator commit (see brief: "DO NOT edit packages/video-templates/
// src/index.ts"). Using @borradh-workspace/video-templates/authority-1 keeps
// the dependency on the canonical TemplateDoc definition (single source of
// truth) without depending on integrator ordering.
import { authority1 } from '@borradh-workspace/video-templates/authority-1';

import type { BrandFieldsForTheme } from '../converter-types.js';

export interface AuthorityConversionResult {
  templateDoc: TemplateDoc;
  templateId: 'authority-1';
  brandFieldsForTheme: BrandFieldsForTheme;
}

function hexish(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return /^#[0-9A-Fa-f]{3,8}$/.test(value) ? value : undefined;
}

export function convertAuthority1(
  draftConfig: VideoDraftConfig
): AuthorityConversionResult {
  const outro = draftConfig.outro;

  // Build the brand-fields side channel. Each branch is filled only when v1
  // had a real value — wave 7's backfill merges this onto the org's brand_kit
  // row, so leaving a branch undefined means "fall through to the existing
  // brand_kit / engineDefaultTheme".
  const brandFieldsForTheme: BrandFieldsForTheme = {};

  // Colours — v1 stored outro.backgroundColor / textColor. Map to primary /
  // onPrimary (the design's contrast pair). v1 had no separate secondary or
  // accent so those stay unset and fall through.
  const primary = hexish(outro?.backgroundColor);
  const onPrimary = hexish(outro?.textColor);
  if (primary || onPrimary) {
    brandFieldsForTheme.colors = {};
    if (primary) brandFieldsForTheme.colors.primary = primary;
    if (onPrimary) brandFieldsForTheme.colors.onPrimary = onPrimary;
  }

  // Logo — v1 stored outro.logoUrl (single URL, treated as the "light" variant
  // since most clinic logos are rendered on the dark/over-video outro card).
  if (outro?.logoUrl) {
    brandFieldsForTheme.logo = { light: outro.logoUrl };
  }

  // Identity — businessName + ctaText surface in the outro card. v1 had no
  // separate tagline/address/bookingUrl/currency fields on the authority shape;
  // they fall through to the brand_kit / engine defaults.
  const identity: BrandFieldsForTheme['identity'] = {};
  if (outro?.businessName) identity.businessName = outro.businessName;
  if (outro?.ctaText) identity.ctaText = outro.ctaText;
  if (Object.keys(identity).length > 0) {
    brandFieldsForTheme.identity = identity;
  }

  // Music — v1 stored musicTrackId on the video, which is per-video, not a
  // brand-wide preference. Theme.music carries `preferredMoods` (an array
  // hint for the synth gate's music ranking), not a specific track. We don't
  // surface musicTrackId here today: per-video music overrides are a separate
  // mechanism (themeOverridesForVideo or a videos table field) that wave 7
  // owns. Flag for follow-up.

  return {
    templateDoc: authority1,
    templateId: 'authority-1',
    brandFieldsForTheme,
  };
}

export type ConvertAuthority1Result = ReturnType<typeof convertAuthority1>;
