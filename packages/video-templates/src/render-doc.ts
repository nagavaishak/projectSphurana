// Renderer-agnostic resolved shapes (§15.1).
//
// The compiler ("Phase B") consumes a TemplateDoc plus assets/scripts/etc. and
// emits a RenderDoc whose every value is concrete and frame-accurate. No slot
// queries, no anchors, no token lookups, no "content"-duration resolution at
// render time — all of that has happened by the time we reach a RenderDoc.
//
// CRITICAL: nothing in this file may import from @borradh-workspace/remotion.
// Per the punch-list invariant, RenderDoc is the contract between Phase B and
// *any* renderer; baking Remotion types in here means a non-Remotion renderer
// (a server-side rasteriser, an editor preview, a static debug dump) has to
// pull a 300MB graphics library transitively to read it.

import type { AnimationToken, TransitionToken } from './registries/index.js';
import type { OverlayAnchor } from './template-doc.js';
import type { Theme } from './theme.js';

export type RenderOrientation = 'portrait' | 'landscape' | 'square';

// ── Resolved primitives ─────────────────────────────────────────────

export interface ResolvedDimensions {
  width: number;
  height: number;
}

// ResolvedTypeStyle — concrete shape baked at Phase B compile-time from a
// TypeStyleToken + (optional) Theme. The renderer applies these values
// directly; no token lookup at render time. Sizes assume a 1080-tall portrait
// canvas as the design baseline — the renderer may scale for other aspects.
export interface ResolvedTypeStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  /** em units. */
  letterSpacing: number;
  textTransform: 'none' | 'uppercase';
  color: string;
  /** 'italic' for serif/editorial lines (v1 aesthetic-line). Default 'normal'. */
  fontStyle?: 'italic' | 'normal';
  /** px stroke width; renderer draws a stroke behind the fill when > 0. */
  strokeWidth?: number;
  /** Stroke colour (rgba ok). Defaults to '#000000' when strokeWidth is set. */
  strokeColor?: string;
  /** Full CSS text-shadow string, applied verbatim. Carries v1 per-role shadows. */
  textShadow?: string;
}

// Region-relative 0–1 placement. Renderers translate to absolute CSS/px.
export interface ResolvedOverlayPlacement {
  anchor: OverlayAnchor;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface ResolvedMediaClip {
  id: string;
  url: string;
  mediaType: 'video' | 'image';
  /** Frames trimmed from the start of the source */
  trimStartFrames: number;
  /** Length of the source after trimming, in frames (when known) */
  naturalDurationFrames?: number;
  /** Position within the owning region, in absolute frames */
  startFrame: number;
  /** Visible length within the owning region, in absolute frames */
  durationInFrames: number;
  /** Renderer maps this token to a concrete enter/exit effect. */
  transition?: TransitionToken;
}

export interface ResolvedTextElement {
  /** Stable id so animations can be addressed individually. */
  id: string;
  text: string;
  typeStyle: ResolvedTypeStyle;
  container?: 'none' | 'pill' | 'button' | 'plate';
  entrance: AnimationToken;
  /** Local entrance frame, relative to the owning block's startFrame. */
  entranceFrame: number;
  /** Optional override for how many frames the entrance animation spans. */
  entranceDurationFrames?: number;
  /** Optional small label rendered above this element (e.g. "IMPROVES:"). */
  kicker?: { text: string; typeStyle: ResolvedTypeStyle };
}

// ── Resolved blocks ─────────────────────────────────────────────────
// Each block kind has its own concrete params shape — that's what the renderer
// reads. The interpreter (registry) dispatches on `kind`.

export interface ResolvedBlockBase {
  kind: string;
  id: string;
  /** Position within the owning region, in absolute frames. */
  startFrame: number;
  durationInFrames: number;
}

export interface ResolvedMediaTrackBlock extends ResolvedBlockBase {
  kind: 'media-track';
  clips: ResolvedMediaClip[];
  /** Used by the renderer to letterbox or fill. Default: cover. */
  fit?: 'cover' | 'contain' | 'contain-blur';
}

export interface ResolvedSolidBlock extends ResolvedBlockBase {
  kind: 'solid';
  color: string;
}

export interface ResolvedStaggeredListBlock extends ResolvedBlockBase {
  kind: 'staggered-list';
  /** Optional first element (e.g. the question/hook). */
  lead?: ResolvedTextElement;
  /** Repeating list (e.g. the bullets). */
  items: ResolvedTextElement[];
  /** Optional last element (e.g. the CTA). */
  trail?: ResolvedTextElement;
  /** Stagger interval, in absolute frames. */
  beatsPerItemFrames: number;
  /** Reveal mode: accumulate (default) or sequential (one element at a time). */
  reveal?: 'accumulate' | 'sequential';
  /** Draw an index badge before each item (v1 numbered-list). */
  numbered?: boolean;
  /** Horizontal alignment of the list (v1 numbered-list is left). Default 'center'. */
  hAlign?: 'left' | 'center' | 'right';
  placement?: ResolvedOverlayPlacement;
}

// Stubs for the wave-2 blocks. They live in this file (rather than ad-hoc) so
// the renderer registry can register placeholder components against a real,
// typed shape — and so the TemplateDoc → RenderDoc compiler has somewhere to
// write to once those blocks land. Wave 2 fills out the params.

export interface ResolvedTextBlock extends ResolvedBlockBase {
  kind: 'text';
  text: string;
  typeStyle: ResolvedTypeStyle;
  entrance: AnimationToken;
  /** Optional override for the entrance length (frames). */
  entranceDurationFrames?: number;
  /** Frames to wait before the entrance plays; element hidden until then. */
  entranceDelayFrames?: number;
  /** Optional pill/button frame around the text. */
  container?: 'none' | 'pill' | 'button' | 'plate';
  placement?: ResolvedOverlayPlacement;
}

// Where the media-overlay paints itself within the region.
//
// - 'full-bleed' fills the region (full-screen reveal pattern)
// - 'corner' is a PiP in one of the four corners, sized as ratio of region
// - 'rect' is an explicit 0–1 region-relative rectangle
export type ResolvedMediaOverlayPlacement =
  | 'full-bleed'
  | { kind: 'corner'; corner: 'tl' | 'tr' | 'bl' | 'br'; sizeRatio: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number };

export interface ResolvedMediaOverlayKenBurns {
  from: 'center' | 'left' | 'right';
  zoomFrom: number;
  zoomTo: number;
}

export interface ResolvedMediaOverlayLabel {
  text: string;
  typeStyle: ResolvedTypeStyle;
  corner: 'tl' | 'tr' | 'bl' | 'br';
}

export interface ResolvedMediaOverlayBlock extends ResolvedBlockBase {
  kind: 'media-overlay';
  /** Single clip (e.g. PiP photo or full-screen reveal). */
  clip: ResolvedMediaClip;
  placement: ResolvedMediaOverlayPlacement;
  fit: 'cover' | 'contain' | 'contain-blur';
  kenBurns?: ResolvedMediaOverlayKenBurns;
  label?: ResolvedMediaOverlayLabel;
}

export type ResolvedInfoCardLayout = 'centered' | 'left-aligned' | 'stacked';

export type ResolvedInfoCardBackground =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; from: string; to: string; angle?: number };

export interface ResolvedInfoCardItems {
  texts: string[];
  typeStyle: ResolvedTypeStyle;
}

export interface ResolvedInfoCardPrice {
  value: string;
  currency: string;
  typeStyle: ResolvedTypeStyle;
}

export interface ResolvedInfoCardCta {
  text: string;
  url?: string;
  typeStyle: ResolvedTypeStyle;
}

export interface ResolvedInfoCardLogo {
  url: string;
  position: 'top' | 'bottom';
  size?: 'badge' | 'hero';
}

export interface ResolvedInfoCardBlock extends ResolvedBlockBase {
  kind: 'info-card';
  layout: ResolvedInfoCardLayout;
  headline?: { text: string; typeStyle: ResolvedTypeStyle };
  items?: ResolvedInfoCardItems;
  price?: ResolvedInfoCardPrice;
  cta?: ResolvedInfoCardCta;
  logo?: ResolvedInfoCardLogo;
  background: ResolvedInfoCardBackground;
  /**
   * Brand accent baked from the Theme at compile time. The renderer uses it
   * for the CTA button fill (`color`) + its text (`onColor`) and for list
   * bullet markers, so a branded info-card reads on-brand rather than with the
   * renderer's neutral fallback. Optional — legacy RenderDocs without it fall
   * back to a neutral palette.
   */
  accent?: { color: string; onColor: string };
  entrance: AnimationToken;
  entranceDurationFrames?: number;
  placement?: ResolvedOverlayPlacement;
}

export type ResolvedBlock =
  | ResolvedMediaTrackBlock
  | ResolvedSolidBlock
  | ResolvedStaggeredListBlock
  | ResolvedTextBlock
  | ResolvedMediaOverlayBlock
  | ResolvedInfoCardBlock;

// ── Resolved region tree ────────────────────────────────────────────
// Mirrors TemplateRegion exactly but with `Resolved*` blocks. Splits/leaves
// must traverse identically at runtime (§4).

export interface ResolvedRegionLeaf {
  kind: 'leaf';
  id: string;
  spine: ResolvedBlock[];
  overlays: ResolvedBlock[];
}

export interface ResolvedRegionSplit {
  kind: 'split';
  axis: 'h' | 'v';
  children: { ratio: number; region: ResolvedRegion }[];
}

export type ResolvedRegion = ResolvedRegionLeaf | ResolvedRegionSplit;

// ── Globals ─────────────────────────────────────────────────────────

export interface ResolvedMusicTrack {
  trackId: string;
  url: string;
  volume: number;
  /** Optional BPM, used by the renderer for beat-synced FX. */
  bpm?: number;
}

export type ResolvedNarration =
  | {
      source: 'tts';
      url: string;
      /** Position within the doc, in absolute frames. */
      startFrame: number;
      durationInFrames: number;
      volume?: number;
    }
  | {
      source: 'clip';
      /** Reference to a ResolvedMediaClip.id elsewhere in the spine. */
      clipRef: string;
      lift: true;
      /**
       * Concrete, Lambda-playable URL of the lifted clip's audio. Baked so the
       * renderer can mount a single `<Audio>` for the talking-head voice while
       * the video track stays muted (avoids double audio). Refreshed on retry.
       */
      url?: string;
      durationInFrames?: number;
      volume?: number;
    };

/** Per-word caption timing (ms, doc-relative) — drives word-by-word highlight. */
export interface ResolvedCaptionWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface ResolvedCaptionsPage {
  /** Page Sequence bounds, in absolute frames. */
  fromFrame: number;
  toFrame: number;
  text: string;
  typeStyle: ResolvedTypeStyle;
  /**
   * Per-word timing in milliseconds (doc-relative). Powers the v1-style
   * word-by-word highlight. May be empty/absent on legacy RenderDocs; the
   * renderer falls back to whole-page display in that case.
   */
  words?: ResolvedCaptionWord[];
}

/**
 * Concrete TikTok-style caption style baked at compile time from the video's
 * draft caption config plus stroke defaults. Mirrors the renderer's
 * TikTokCaptionStyle so the renderer can consume it directly. Kept here (not
 * imported from Remotion) to preserve the renderer-agnostic invariant.
 */
export interface ResolvedTikTokCaptionStyle {
  position: 'top' | 'center' | 'bottom';
  fontFamily: string;
  fontSize: number;
  color: string;
  highlightColor: string;
  backgroundColor: string;
  showBackground: boolean;
  strokeWidth: number;
  strokeColor: string;
}

export interface ResolvedCaptions {
  pages: ResolvedCaptionsPage[];
  typeStyle: ResolvedTypeStyle;
  /**
   * Concrete TikTok caption style. Optional only for back-compat with legacy
   * persisted RenderDocs; new compiles always populate it.
   */
  tikTokStyle?: ResolvedTikTokCaptionStyle;
}

// ── Top-level RenderDoc ─────────────────────────────────────────────

export interface RenderDoc {
  schemaVersion: 2;
  videoId: string;
  templateDocId: string;

  /** Frames per second. */
  fps: number;
  /** Final canvas dimensions (after orientation resolution). */
  dimensions: ResolvedDimensions;
  /** Total length of the rendered video, in absolute frames. */
  durationInFrames: number;
  /** Orientation kept alongside dimensions so the renderer can pick a composition. */
  orientation: RenderOrientation;

  /** Recursive region tree. Leafs hold the actual blocks; splits clip+layout. */
  root: ResolvedRegion;

  globals: {
    audio: {
      music?: ResolvedMusicTrack;
      narration?: ResolvedNarration;
    };
    captions?: ResolvedCaptions;
    /**
     * Resolved Theme baked at compile time (§17 resolution cascade:
     * engine defaults → org brand_kit → per-video overrides). Persisted on
     * the RenderDoc so retries replay deterministically. Optional only for
     * back-compat with pre-wave-5 persisted RenderDocs; new compiles always
     * populate this.
     */
    theme?: Theme;
  };
}
