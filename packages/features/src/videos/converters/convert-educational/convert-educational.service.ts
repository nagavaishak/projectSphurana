// convertEducational — pure function from a v1 educational-{1,2,3} draftConfig
// to the v2 (TemplateDoc, brandFieldsForTheme, themeOverridesForVideo,
// frozenScript) bundle.
//
// Shape D per the design doc Appendix:
//   leaf region with `media-track`(fill) holding b-roll + a `staggered-list`
//   overlay (educational-1, -3) or staggered-list + closing info-card
//   (educational-2). No narration, no captions — text-only register matches
//   v1 narrationMode: 'text_only'.
//
// One converter, three variation ids — the v1 educational variations differ in
// their script template + clip mix + closing beat (CTA vs disclaimer). The
// three v2 TemplateDocs already encode those differences in their entrance
// tokens, stagger cadence, and overlay set; this converter just picks by id
// and projects the v1 brand fields + frozen script.
//
// What it maps:
//   v1 scriptText            → frozenScript.{hook,body[],cta,disclaimer}
//                              The v1 path used a free-form newline-separated
//                              script; we parse it into the role buckets so
//                              Phase A's re-synth path can preserve the
//                              original text verbatim instead of letting
//                              Claude regenerate.
//   v1 outro.businessName    → brandFieldsForTheme.identity.businessName
//   v1 outro.logoUrl         → brandFieldsForTheme.logo.light
//   v1 outro.ctaText         → brandFieldsForTheme.identity.ctaText
//   v1 outro.{bg,text}Color  → brandFieldsForTheme.colors.{primary,onPrimary}
//                              (only when both are valid hex)
//   v1 musicTrackId          → themeOverridesForVideo.musicTrackId
//   v1 musicVolume           → themeOverridesForVideo.musicVolume
//
// What it does NOT carry:
//   v1 talkingHeadAssetId / aiVoiceId — educational is text_only; v1 ignored
//   these on the educational path. No-op on conversion.
//
//   v1 bRollClips — wave-7 backfill replays them by re-resolving the
//   `asset-clips` slot against the org's library at compile time; the
//   recommended clip count is 2 (educational-1) / 3 (-2, -3) per v1
//   recommendedClipCount, and the slot's count: [1, 4] range absorbs that.

import type { VideoDraftConfig } from '@borradh-workspace/database';
import type { TemplateDoc } from '@borradh-workspace/video-templates';

// Subpath imports rather than the barrel — matches the convention established
// by convert-authority-1 / convert-authority-tts / convert-before-after /
// convert-offer-square. The wave-6 integrator owns the barrel index.
import { educational1 } from '@borradh-workspace/video-templates';
import { educational2 } from '@borradh-workspace/video-templates/educational-2';
import { educational3 } from '@borradh-workspace/video-templates/educational-3';

import type {
  BrandFieldsForTheme,
  ThemeOverridesForVideo,
} from '../converter-types.js';

export type EducationalVariationId =
  | 'educational-1'
  | 'educational-2'
  | 'educational-3';

/**
 * The script-text values frozen from a v1 draftConfig. The v2 synthesizer
 * regenerates scripts through the per-role resolver (wave 4-B) by default;
 * when this is present on the synthesize input, phase-a-script skips the
 * Claude call and uses these values verbatim. That preserves the original
 * hand-edited v1 copy on re-render.
 *
 * Each field is independently optional — partial v1 scripts (missing
 * disclaimer or CTA) don't synthesize as empty strings.
 */
export interface FrozenScript {
  hook?: string;
  body?: string[];
  cta?: string;
  disclaimer?: string;
}

export interface EducationalConversionResult {
  templateDoc: TemplateDoc;
  templateId: EducationalVariationId;
  brandFieldsForTheme: BrandFieldsForTheme;
  themeOverridesForVideo?: ThemeOverridesForVideo;
  /** v1 hand-edited script preserved verbatim. */
  frozenScript?: FrozenScript;
}

function hexish(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return /^#[0-9A-Fa-f]{3,8}$/.test(value) ? value : undefined;
}

function pickTemplate(variationId: EducationalVariationId): TemplateDoc {
  // Exhaustive switch — TS compile fails if EducationalVariationId grows.
  switch (variationId) {
    case 'educational-1':
      return educational1;
    case 'educational-2':
      return educational2;
    case 'educational-3':
      return educational3;
  }
}

/**
 * Heuristic-based script line classification.
 *
 * The v1 scriptTemplates are role-implicit (no explicit per-line role tags).
 * We classify lines into roles by a small set of rules tuned against the v1
 * template-definitions:
 *   - The first non-empty line is the hook.
 *   - A line containing "results vary", "consultation required", or any
 *     disclaimer-flavour keyword is the disclaimer.
 *   - A line containing "DM" or "book" (case-insensitive) and short
 *     (<= ~8 words) is the CTA.
 *   - Everything else is body.
 *
 * This is intentionally lossy — the goal is to map v1 hand-edited scripts to
 * the v2 role enum without inventing structure. If users hand-edited the
 * v1 script with non-standard structure, body absorbs the leftovers, which
 * still preserves the text on re-render.
 */
function classifyScriptLines(scriptText: string | undefined): FrozenScript {
  if (!scriptText) return {};
  const lines = scriptText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return {};

  const isDisclaimer = (l: string): boolean => {
    const lower = l.toLowerCase();
    return (
      lower.includes('results vary') ||
      lower.includes('consultation required') ||
      lower.includes('disclaimer') ||
      lower.includes('not medical advice')
    );
  };
  const isCta = (l: string): boolean => {
    const lower = l.toLowerCase();
    const wordCount = l.split(/\s+/).length;
    if (wordCount > 8) return false;
    return (
      lower.includes('dm') ||
      lower.startsWith('book ') ||
      lower.includes('learn more') ||
      lower.includes('contact us') ||
      lower.includes('link in bio')
    );
  };

  const out: FrozenScript = {};
  out.hook = lines[0];
  const body: string[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    if (isDisclaimer(line) && out.disclaimer === undefined) {
      out.disclaimer = line;
    } else if (isCta(line) && out.cta === undefined) {
      out.cta = line;
    } else {
      body.push(line);
    }
  }
  if (body.length > 0) out.body = body;
  return out;
}

export function convertEducational(
  variationId: EducationalVariationId,
  draftConfig: VideoDraftConfig
): EducationalConversionResult {
  const outro = draftConfig.outro;

  // ── brandFieldsForTheme ──────────────────────────────────────────────
  // Same cascade rule as the other converters: only fill a branch when v1
  // had a real value; missing branches fall through to brand_kit /
  // engineDefaults.
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

  // ── themeOverridesForVideo (per-video pinning) ───────────────────────
  // Educational is text-only — no narration voice. Music is the only
  // per-video knob.
  const themeOverridesForVideo: ThemeOverridesForVideo = {};
  if (
    typeof draftConfig.musicTrackId === 'string' &&
    draftConfig.musicTrackId.length > 0
  ) {
    themeOverridesForVideo.musicTrackId = draftConfig.musicTrackId;
  }
  if (typeof draftConfig.musicVolume === 'number') {
    themeOverridesForVideo.musicVolume = draftConfig.musicVolume;
  }
  const hasOverrides = Object.keys(themeOverridesForVideo).length > 0;

  // ── frozenScript ─────────────────────────────────────────────────────
  // The v1 scriptText carries the user's hand-edited content. Without
  // freezing it, the v2 re-synth path runs Claude against the v1 template
  // prompt and generates fresh copy — losing whatever the user actually
  // shipped. The backfill writes this so the next render reads frozen text
  // instead of re-generating.
  const frozenScript = classifyScriptLines(draftConfig.scriptText);
  const hasFrozen = Object.keys(frozenScript).length > 0;

  return {
    templateDoc: pickTemplate(variationId),
    templateId: variationId,
    brandFieldsForTheme,
    themeOverridesForVideo: hasOverrides ? themeOverridesForVideo : undefined,
    frozenScript: hasFrozen ? frozenScript : undefined,
  };
}

export type ConvertEducationalResult = ReturnType<typeof convertEducational>;
