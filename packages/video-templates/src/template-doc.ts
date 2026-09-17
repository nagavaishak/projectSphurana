import type {
  AnimationToken,
  FontToken,
  TransitionToken,
  TypeStyleToken,
} from './registries/index.js';
import type { Slot } from './slot.js';

export type TemplateOrientation = 'portrait' | 'landscape' | 'square';

export type TemplateDuration =
  | { kind: 'fixed'; frames: number }
  | { kind: 'driven'; by: 'narration' | string };

export type BlockDuration =
  | { kind: 'fixed'; frames: number }
  | { kind: 'content' }
  | { kind: 'fill'; weight?: number };

/**
 * Where an overlay starts on the master timeline.
 *   - `sequential` (default): starts where the previous overlay ended — the
 *     existing accumulator behaviour (cutaways cluster from t=0).
 *   - `from-end`: anchored so the overlay *finishes* at the master end
 *     (startFrame = master − duration). Generic end-card / outro placement for
 *     narration-driven templates whose content doesn't tile the full master.
 * Generic and reusable — no template knows about it; any overlay can opt in.
 */
export type OverlayStart = 'sequential' | 'from-end';

export type MediaSource = {
  url: string;
  mediaType: 'video' | 'image';
  trimStartFrames: number;
  naturalDurationFrames?: number;
};

export type MediaFit = 'cover' | 'contain' | 'contain-blur';

export type MediaCuts =
  | { mode: 'beat-synced'; beatsPerEdit: number }
  | { mode: 'even' }
  | { mode: 'clip-length' }
  // Cut the b-roll to match a sequential overlay's statement windows: exactly
  // one clip per on-screen statement (cycling the uploaded clips), so the scene
  // changes on every statement change (v1 fade-benefits / improves: 1 clip ↔
  // 1 line). No-op if the leaf has no sequential staggered-list.
  | { mode: 'overlay-synced' };

export interface TemplateMediaTrack {
  kind: 'media-track';
  id: string;
  duration: BlockDuration;
  clips: Slot<MediaSource[]>;
  fit?: MediaFit;
  cuts?: MediaCuts;
  transition?: TransitionToken;
  kenBurnsOnImages?: boolean;
  fillMode?: 'loop' | 'hold';
}

export interface TemplateSolid {
  kind: 'solid';
  id: string;
  duration: BlockDuration;
  color: Slot<string>;
}

export type TemplateSpineBlock = TemplateMediaTrack | TemplateSolid;

/**
 * Per-element overrides onto a resolved type style. Any field set here wins over
 * the value the `style` token resolves to at Phase B. This lets a template carry
 * v1's hand-tuned per-role values (sizes, colours, stroke, shadow, italic)
 * without forking the shared token palette.
 */
export interface TypeStyleOverride {
  fontSize?: number;
  fontWeight?: number;
  /** em units. */
  letterSpacing?: number;
  textTransform?: 'none' | 'uppercase';
  /** Literal CSS colour. Wins over `colorRole` if both set. */
  color?: string;
  /** Bind colour to a theme role (resolved at compile time). */
  colorRole?:
    | 'primary'
    | 'secondary'
    | 'accent'
    | 'surface'
    | 'onSurface'
    | 'onPrimary'
    | 'muted';
  fontStyle?: 'italic' | 'normal';
  strokeWidth?: number;
  strokeColor?: string;
  /** Full CSS text-shadow string, applied verbatim. */
  textShadow?: string;
  /**
   * Per-element font face override. Wins over the `style` token's font so a
   * template can pick e.g. a cursive script (`allura`) for one line without
   * rebinding a whole type-style role. Resolved to a family string at Phase B.
   */
  fontRef?: FontToken;
}

/** Text element container chrome. `plate` is a dark rounded backing for
 *  legible labels/interstitials over busy footage. */
export type TextContainer = 'none' | 'pill' | 'button' | 'plate';

export type ListElement = {
  style: TypeStyleToken;
  styleOverride?: TypeStyleOverride;
  container?: TextContainer;
  entrance: AnimationToken;
};

/** A small fixed label rendered ABOVE every item (e.g. "IMPROVES:", "STEP:",
 *  "TIP:"). Same text on each item; its own type style. */
export type ListItemKicker = {
  text: Slot<string>;
  style: TypeStyleToken;
  styleOverride?: TypeStyleOverride;
};

export interface TemplateStaggeredList {
  kind: 'staggered-list';
  id: string;
  duration: BlockDuration;
  lead?: ListElement & { text: Slot<string> };
  items: ListElement & { texts: Slot<string[]>; kicker?: ListItemKicker };
  trail?: ListElement & { text: Slot<string> };
  stagger: { beatsPerItem: number };
  /** `accumulate` (default) stacks items; `sequential` shows one at a time
   *  (v1 text-frame interstitials). */
  reveal?: 'accumulate' | 'sequential';
  /** Draw an index badge before each item (v1 numbered-list). */
  numbered?: boolean;
  align?: 'top' | 'center' | 'bottom';
  /** Horizontal alignment of the list block (v1 numbered-list is left). Default 'center'. */
  hAlign?: 'left' | 'center' | 'right';
  placement?: OverlayPlacement;
  start?: OverlayStart;
}

export type OverlayAnchor =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

export interface OverlayPlacement {
  anchor: OverlayAnchor;
  x: number; // region-relative, 0–1
  y: number; // region-relative, 0–1
  width?: number; // region-relative, 0–1; overlay sizes itself if omitted
  height?: number; // region-relative, 0–1
}

export interface TemplateText {
  kind: 'text';
  id: string;
  text: Slot<string>;
  style: TypeStyleToken;
  styleOverride?: TypeStyleOverride;
  animation: {
    entrance: AnimationToken;
    entranceDurationFrames?: number;
    /**
     * Frames to wait (after the block's own start) before the entrance plays.
     * The element is hidden until then. Lets stacked overlays sequence — e.g.
     * caption-tease types the headline, then the caption a beat later.
     */
    entranceDelayFrames?: number;
  };
  placement?: OverlayPlacement;
  duration: BlockDuration;
  container?: TextContainer;
  start?: OverlayStart;
}

export type MediaOverlayCorner = 'tl' | 'tr' | 'bl' | 'br';

// `placement` here is media-overlay specific — it carries a different shape
// from the generic OverlayPlacement (anchor + x/y) because PiP/full-bleed/rect
// are the meaningful primitives for media insets.
export type TemplateMediaOverlayPlacement =
  | 'full-bleed'
  | { kind: 'corner'; corner: MediaOverlayCorner; sizeRatio: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number };

export interface TemplateMediaOverlay {
  kind: 'media-overlay';
  id: string;
  clip: Slot<MediaSource>;
  placement: TemplateMediaOverlayPlacement;
  fit: MediaFit;
  kenBurns?: {
    from: 'center' | 'left' | 'right';
    zoomFrom: number;
    zoomTo: number;
  };
  label?: {
    text: Slot<string>;
    style: TypeStyleToken;
    styleOverride?: TypeStyleOverride;
    corner: MediaOverlayCorner;
  };
  duration: BlockDuration;
  start?: OverlayStart;
}

export type InfoCardLayout = 'centered' | 'left-aligned' | 'stacked';

export type InfoCardBackground =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; from: string; to: string; angle?: number };

export interface TemplateInfoCard {
  kind: 'info-card';
  id: string;
  layout: InfoCardLayout;
  // Optional: a logo-only outro (v1 authority tagline outro) has no headline.
  headline?: { text: Slot<string>; style: TypeStyleToken };
  items?: { texts: Slot<string[]>; style: TypeStyleToken };
  price?: {
    value: Slot<string>;
    currency: Slot<string>;
    style: TypeStyleToken;
  };
  cta?: { text: Slot<string>; url?: Slot<string>; style: TypeStyleToken };
  // `size: 'hero'` renders the logo large + centered (v1 logo-hero outro);
  // default 'badge' is the small corner/top mark.
  logo?: {
    url: Slot<string>;
    position: 'top' | 'bottom';
    size?: 'badge' | 'hero';
  };
  background: InfoCardBackground;
  entrance: { animation: AnimationToken; entranceDurationFrames?: number };
  duration: BlockDuration;
  placement?: OverlayPlacement;
  start?: OverlayStart;
}

export type TemplateOverlayBlock =
  | TemplateStaggeredList
  | TemplateText
  | TemplateMediaOverlay
  | TemplateInfoCard;

// Overlay kinds whose `placement` is the standard anchor+x/y OverlayPlacement.
// media-overlay uses a different placement model (full-bleed / corner / rect),
// so editors that drive anchor-relative drag handles narrow against this type
// rather than walking every overlay block.
export type AnchorPlacedOverlayBlock =
  | TemplateStaggeredList
  | TemplateText
  | TemplateInfoCard;

export function isAnchorPlacedOverlayBlock(
  block: TemplateOverlayBlock
): block is AnchorPlacedOverlayBlock {
  return block.kind !== 'media-overlay';
}

export type TemplateRegion =
  | {
      kind: 'leaf';
      id: string;
      spine: TemplateSpineBlock[];
      overlays: TemplateOverlayBlock[];
    }
  | {
      kind: 'split';
      axis: 'h' | 'v';
      children: { ratio: number; region: TemplateRegion }[];
    };

export interface MusicSelection {
  trackId: string;
  volume: number;
}

export interface TemplateDoc {
  id: string;
  schemaVersion: 2;
  aspectRatios: TemplateOrientation[];
  duration: TemplateDuration;
  root: TemplateRegion;
  globals: {
    audio: {
      narration?:
        | { source: 'tts'; fromScript: true; voice?: string }
        | { source: 'clip'; clipRef: string };
      music?: Slot<MusicSelection>;
    };
    captions?: { from: 'narration'; style: TypeStyleToken };
  };
}
