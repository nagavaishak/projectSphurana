// Shared types for v1 → v2 template converters.
//
// Each per-shape converter (convert-authority-1, convert-before-after-1, etc.)
// returns a TemplateDoc plus a side-channel `brandFieldsForTheme` carrying the
// brand-shaped values extracted from the v1 draftConfig. Wave 7's data-backfill
// reads these fields to seed the org's `brand_kit` row, then the synthesizer's
// theme-resolution cascade (engineDefaultTheme → brandKit → per-video
// overrides — see packages/video-templates/src/theme.ts) projects them back
// into the RenderDoc at compile time.
//
// The brand fields live OUTSIDE the TemplateDoc by design: §17 locks Theme as
// a synthesis input, not a TemplateDoc field. TemplateDocs cite roles + tokens,
// the synthesizer multiplies TemplateDoc × Theme. Persisting brand colours /
// logos / business name inside the v2 TemplateDoc would couple every authored
// template to a single org's brand — exactly the coupling the design avoids.

import type { Theme, ThemeOverrides } from '@borradh-workspace/video-templates';

/**
 * Partial<Theme>-shaped brand fields extracted from a v1 draftConfig. Each top
 * branch is independently optional so a converter only fills the slices it
 * actually has values for.
 *
 * Wave 7's backfill folds these into the org's `brand_kit` row (the
 * persistence layer for Theme — see theme.ts). The DB row is canonical; this
 * type is the wire shape between converter → backfill.
 */
export type BrandFieldsForTheme = {
  colors?: Partial<Theme['colors']>;
  logo?: Partial<Theme['logo']>;
  identity?: Partial<Theme['identity']>;
  music?: Partial<Theme['music']>;
};

/**
 * Per-video theme overrides side-channel. Used when a v1 video carried a
 * non-default value that belongs as a per-video override rather than as an
 * org-wide brand setting (e.g. an offer-card-only one-off colour, or a
 * one-off TTS voice for an AI-voiceover authority video).
 *
 * The Theme-shaped overrides come straight through `ThemeOverrides`. The
 * sibling fields (`narrationVoice`, `musicTrackId`, `musicVolume`) carry
 * synthesis-input values that don't fit Theme — Theme has no voice/music-id
 * concept; those belong to the synthesizer's narration / music config and
 * Wave 7's backfill projects them onto the video row.
 *
 * All fields optional. Converters set only what v1 actually stored.
 */
export type ThemeOverridesForVideo = ThemeOverrides & {
  /** v1 `aiVoiceId` — TTS voice the user picked for this specific video. */
  narrationVoice?: string;
  /** v1 `musicTrackId` — specific track the user picked (overrides gate). */
  musicTrackId?: string;
  /** v1 `musicVolume` (0..1) — user-tuned music level for this video. */
  musicVolume?: number;
};
