// convertAuthorityTts — pure function from a v1 authority-2 OR authority-3
// draftConfig to the v2 (TemplateDoc, brandFieldsForTheme) pair.
//
// Shape B per the design doc Appendix:
//   leaf region with `media-track`(fill) holding b-roll + `audio.narration =
//   tts` global; Whisper transcribes the synthesized TTS audio into captions.
//
// One converter, two variation ids — authority-2 and authority-3 differed in
// v1 only by *script template prompt* (credibility tone vs proof/standards
// tone). Visual layout, clip mix, max b-roll, and rendering config were
// identical. The two v2 TemplateDocs encode the small stylistic difference
// (slide-up + pill vs fade-in + display) so the converter just picks by id.
//
// What it maps:
//   v1 aiVoiceId       → themeOverridesForVideo.narrationVoice (per-video,
//                         not org-wide — different videos may want different
//                         voices and Theme.identity has no voice field today)
//   v1 musicTrackId    → themeOverridesForVideo.musicTrackId   (per-video)
//   v1 musicVolume     → themeOverridesForVideo.musicVolume    (per-video)
//   v1 outro.*         → brandFieldsForTheme (logo / colors / identity)
//
// What it does NOT carry:
//   v1 scriptText      → not baked into the TemplateDoc. Phase A re-generates
//                         per the role/index slot model. If product wants to
//                         honour a hand-edited v1 script verbatim on v2, the
//                         synth service grows a `scriptOverride` knob and the
//                         converter passes it through `themeOverridesForVideo`
//                         or a sibling channel; the converter doesn't
//                         pre-decide that today.
//   v1 bRollClips      → not pinned. The new gate picks from the org's
//                         library at compile time using the slot's tag.

import type { VideoDraftConfig } from '@borradh-workspace/database';
import type { TemplateDoc } from '@borradh-workspace/video-templates';

// Subpath imports rather than the barrel — the wave-6 integrator owns the
// barrel (`packages/video-templates/src/index.ts`) and the subpath export
// declarations on the video-templates package.json. This matches the
// convention established by convert-authority-1 / convert-before-after.
import { authority2 } from '@borradh-workspace/video-templates/authority-2';
import { authority3 } from '@borradh-workspace/video-templates/authority-3';

import type {
  BrandFieldsForTheme,
  ThemeOverridesForVideo,
} from '../converter-types.js';

export type AuthorityTtsVariationId = 'authority-2' | 'authority-3';

export interface AuthorityTtsConversionResult {
  templateDoc: TemplateDoc;
  templateId: AuthorityTtsVariationId;
  brandFieldsForTheme: BrandFieldsForTheme;
  themeOverridesForVideo?: ThemeOverridesForVideo;
}

function hexish(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return /^#[0-9A-Fa-f]{3,8}$/.test(value) ? value : undefined;
}

function pickTemplate(variationId: AuthorityTtsVariationId): TemplateDoc {
  // Exhaustive switch — TS compile fails if AuthorityTtsVariationId grows.
  switch (variationId) {
    case 'authority-2':
      return authority2;
    case 'authority-3':
      return authority3;
  }
}

export function convertAuthorityTts(
  variationId: AuthorityTtsVariationId,
  draftConfig: VideoDraftConfig
): AuthorityTtsConversionResult {
  const outro = draftConfig.outro;

  // Brand-fields side channel for wave 7's brand_kit backfill. Each branch
  // is filled only when v1 had a real value — missing branches fall through
  // to the existing brand_kit / engineDefaultTheme during compile.
  const brandFieldsForTheme: BrandFieldsForTheme = {};

  // Colours — v1 stored outro.backgroundColor / textColor as the brand
  // contrast pair. Map to primary / onPrimary. v1 had no separate accent or
  // secondary on the authority shape; those stay unset and fall through.
  const primary = hexish(outro?.backgroundColor);
  const onPrimary = hexish(outro?.textColor);
  if (primary || onPrimary) {
    brandFieldsForTheme.colors = {};
    if (primary) brandFieldsForTheme.colors.primary = primary;
    if (onPrimary) brandFieldsForTheme.colors.onPrimary = onPrimary;
  }

  // Logo — v1 stored outro.logoUrl (single URL, treated as the "light"
  // variant since clinic logos are typically rendered over the dark/video
  // outro card).
  if (outro?.logoUrl) {
    brandFieldsForTheme.logo = { light: outro.logoUrl };
  }

  // Identity — businessName + ctaText surface in the v2 CTA card / outro.
  // The authority-2/3 shape doesn't carry tagline/address/bookingUrl/currency
  // — those fall through to brand_kit / engineDefaultTheme.
  const identity: BrandFieldsForTheme['identity'] = {};
  if (outro?.businessName) identity.businessName = outro.businessName;
  if (outro?.ctaText) identity.ctaText = outro.ctaText;
  if (Object.keys(identity).length > 0) {
    brandFieldsForTheme.identity = identity;
  }

  // Per-video overrides. These attach to the video row, NOT the org's
  // brand_kit — different videos legitimately want different voices and
  // different music. The sibling fields (narrationVoice / musicTrackId /
  // musicVolume) live on ThemeOverridesForVideo precisely because they don't
  // fit Theme.
  const themeOverridesForVideo: ThemeOverridesForVideo = {};
  if (
    typeof draftConfig.aiVoiceId === 'string' &&
    draftConfig.aiVoiceId.length > 0
  ) {
    themeOverridesForVideo.narrationVoice = draftConfig.aiVoiceId;
  }
  if (
    typeof draftConfig.musicTrackId === 'string' &&
    draftConfig.musicTrackId.length > 0
  ) {
    themeOverridesForVideo.musicTrackId = draftConfig.musicTrackId;
  }
  if (typeof draftConfig.musicVolume === 'number') {
    themeOverridesForVideo.musicVolume = draftConfig.musicVolume;
  }

  // Only attach when v1 carried at least one override; downstream readers
  // can short-circuit when the field is absent.
  const hasOverrides = Object.keys(themeOverridesForVideo).length > 0;

  return {
    templateDoc: pickTemplate(variationId),
    templateId: variationId,
    brandFieldsForTheme,
    themeOverridesForVideo: hasOverrides ? themeOverridesForVideo : undefined,
  };
}

export type ConvertAuthorityTtsResult = ReturnType<typeof convertAuthorityTts>;
