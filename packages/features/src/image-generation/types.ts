/**
 * Shared types for the image-generation feature.
 *
 * The nano-banana renderer was removed in favour of a Fabric.js + PPTX
 * pipeline (see `packages/features/src/pptx-import`). This file keeps the
 * renderer-agnostic contracts the orchestrator (planner, slot fills, slot
 * image source) still uses. The renderer-specific contracts —
 * `SlideRenderRequest`, `RenderResult`, `SlideRenderer` — were dropped.
 *
 * TODO (WT): the planner currently still emits a `SlideRenderRequest[]`
 * shape internally; replace with a Fabric-flavoured `FabricSlideFill[]`
 * (or similar) when the new renderer's input contract is defined.
 */

/**
 * How an image slot is filled — either a generation prompt (legacy planner
 * output) or a pre-existing asset URL. The Fabric pipeline will refine this
 * once the new asset-source strategy is designed (WT/WU).
 */
export type SlotImageResolution =
  | { kind: 'generate'; prompt: string }
  | { kind: 'asset'; url: string };

/**
 * Concrete value bound to a single slot for a single render request.
 * The planner emits these. The renderer that consumes them was nano banana;
 * the Fabric replacement will consume a similar shape (text + color slots
 * stay verbatim; the image variant will be reworked in WT).
 */
export type SlotFill =
  | { slotId: string; kind: 'text'; value: string }
  | { slotId: string; kind: 'image'; source: SlotImageResolution }
  | { slotId: string; kind: 'color'; value: string };

/**
 * One slot fill targeting the semantic DesignDocument renderer. Only text
 * and image kinds are supported — color fills are baked into the template's
 * DesignDocument at authoring time (locked shapes) rather than re-applied
 * per render. `slotId` matches the `id` of a `TextObject` / `ImageObject`
 * on the template's DesignDocument slide.
 */
export type DocumentSlideFill =
  | { slotId: string; kind: 'text'; value: string }
  | { slotId: string; kind: 'image'; url: string };

/**
 * Per-slide fill bundle the planner emits and the renderer consumes.
 *
 * `slideIndex` is the zero-based index into `DesignDocument.slides[]` (after
 * the renderer's stable sort by `order`).
 */
export type DocumentSlideFills = {
  templateId: string;
  slideIndex: number;
  fills: DocumentSlideFill[];
};

/**
 * Kind of a slot exposed by an image template. Locked entries are shapes
 * baked into the template's DesignDocument that the planner never targets;
 * they're only surfaced for admin visibility.
 */
export type SlotManifestKind = 'text' | 'image' | 'locked';

/**
 * One entry in a template's slot manifest. Identifies the DesignDocument
 * object the planner / renderer can address by id, on which slide.
 *
 * Built by walking every object in every slide of the imported
 * DesignDocument. Authors control which objects are slots by the names
 * they give shapes in PowerPoint (or whichever Fabric-producing editor
 * they used) — meaningful names become slot ids.
 */
export type SlotManifestEntry = {
  slotId: string;
  kind: SlotManifestKind;
  slideIndex: number;
};

export type SlotManifest = SlotManifestEntry[];

/**
 * Typography metadata for a single `kind: 'text'` slot. The Fabric
 * renderer will consume the same typography shape via fabric.Textbox.
 *
 * Sizes are in pixels on the 1080×1350 canvas. `family` must be one of
 * the fonts shipped in `packages/graphics-image-utils/fonts/` (currently:
 * Inter, Cormorant Garamond, DM Serif Display, Manrope).
 */
export type SlotTypography = {
  /** Font family — must match one of the in-repo font assets. */
  family: string;
  /** Font size in pixels at the 1080×1350 canvas resolution. */
  size: number;
  /** Numeric weight — 400 regular, 500 medium, 600 semibold, 700 bold, 800 extrabold, 900 black. */
  weight: number;
  /** Hex color, e.g. `#FFFFFF`. */
  color: string;
  /** Horizontal alignment within the slot's bbox. */
  align: 'left' | 'center' | 'right';
  /** Line-height multiplier — 1.0-1.2 typical for headlines, 1.3-1.5 for body copy. */
  lineHeight: number;
  /** Optional letter-spacing in em units (e.g. `-0.02` tightens, `0.08` opens up for all-caps labels). */
  letterSpacing?: number;
  /** Optional — italicise the slot's text. */
  italic?: boolean;
  /** Optional — apply uppercase/lowercase transform before rendering. */
  textTransform?: 'uppercase' | 'lowercase' | 'none';
};

/**
 * Slot definition stored on `image_template.slotMap`. Describes a single
 * named region in a template — text, image, or color — and the constraints
 * a planner must respect when filling it.
 *
 * `classification`:
 *   - `'static'`: rendered verbatim from the source PPTX (page counters,
 *     "Next →" arrows, brand chrome). The planner is shown these as
 *     immutable context but never targets them with a fill.
 *   - `'dynamic'`: AI-filled at generation time. The planner uses
 *     `currentText` + `bbox` + `maxChars` (text) or `subjectGuidance` +
 *     `bbox` (image) as the constraints for what to emit.
 *
 * Color slots are baked into the template's DesignDocument at authoring
 * time (locked shapes) rather than re-applied per render — they're not
 * surfaced as fills in v1.
 *
 * `bbox` is the pixel-space rectangle in the template's reference image.
 * `currentText` carries the PPTX-authored text for text slots — it's the
 * concrete anchor the planner reads (no prose "tone" string; the example
 * IS the spec). `maxChars` is the model-assigned character budget for text
 * slots. `subjectGuidance` is a short free-text hint for image slots.
 * `typography` is required for `kind: 'text'` slots and omitted for
 * `image` / `color` slots.
 */
export type ImageSlot = {
  id: string;
  kind: 'text' | 'image' | 'color';
  classification: 'dynamic' | 'static';
  bbox: { x: number; y: number; w: number; h: number };
  /**
   * For text slots: the PPTX-authored text. Static slots render this
   * verbatim; dynamic slots show it to the planner as the anchor for what
   * fits. Always set for text slots after the new pipeline.
   */
  currentText?: string;
  maxChars?: number;
  subjectGuidance?: string;
  typography?: SlotTypography;
};

/**
 * Context passed to a `SlotImageSource` when resolving an image slot.
 * Lets the source make informed decisions — e.g. picking a service-specific
 * asset vs a generic generation prompt.
 */
export type PlanContext = {
  organizationId: string;
  targetServiceId?: string;
  topicSummary?: string;
};

/**
 * Pluggable strategy for filling an image slot. v1 implementation is
 * `AiGeneratedSource` (always returns a generation prompt). A future
 * `BusinessAssetSource` could return real asset URLs when available.
 */
export interface SlotImageSource {
  resolve(slot: ImageSlot, ctx: PlanContext): Promise<SlotImageResolution>;
}

/**
 * The three content modalities the unified topic planner can emit.
 * `carousel` and `single` route through image-generation; `video` routes
 * through the existing video pipeline.
 */
export type ContentModality = 'video' | 'carousel' | 'single';

/**
 * One item in the monthly content plan. The unified topic planner emits a
 * list of these (4 video + 4 carousel + 4 single per org per month); the
 * dispatcher routes each to its modality-specific detail planner.
 *
 * `category` is the editorial axis the image-detail planner filters
 * templates by. Optional on this type because the monthly content planner
 * doesn't pick categories yet — when absent, the image-detail planner
 * defaults to `'tips'` to preserve existing behaviour. The
 * `generate-graphic-from-service` path requires an explicit category.
 */
export type PlannedContentItem = {
  kind: ContentModality;
  category?: import('@borradh-workspace/labels').GraphicCategory;
  targetServiceId: string;
  topicSummary: string;
  rationale: string;
};

/**
 * Output of the unified topic planner for one org for one month. Not
 * persisted as its own table in v1 — the modality-specific rows
 * (`graphic` / `video` / `content_batch_item`) carry the chosen
 * `targetServiceId` and `topicSummary` individually.
 */
export type MonthlyContentPlan = {
  organizationId: string;
  periodMonth: string;
  items: PlannedContentItem[];
};

// ---------------------------------------------------------------------------
// Font resolution — per-template font manifest
// ---------------------------------------------------------------------------

/**
 * Where a font came from in the resolver chain.
 *
 * - `shipped` — already one of the in-repo fonts (no download needed)
 * - `google-fonts` — downloaded from the Google Fonts CSS API and cached
 * - `fallback` — original family wasn't on Google Fonts; we substituted the
 *   nearest shipped family via the serif vs sans heuristic
 */
export type FontResolutionSource = 'shipped' | 'google-fonts' | 'fallback';

/**
 * One resolved font entry on a template's `fontManifest`.
 *
 * Built at PPTX import time by walking every unique (family, weight, italic)
 * tuple the source PPTX used and resolving each via the resolver chain.
 * Embedded in the `DesignDocumentSlotMap` and re-used at render time so
 * node-canvas can register the exact font files the template needs — no
 * per-render Google Fonts lookups, no rendering-time network calls.
 */
export interface FontManifestEntry {
  /** Original font family from the source PPTX, e.g. 'Cormorant Garamond'. */
  originalFamily: string;
  /** CSS weight value (400 = regular, 700 = bold, ...). */
  weight: number;
  /** Whether italic style was requested. */
  italic: boolean;
  /**
   * Family name to use when registering with node-canvas (may differ from
   * `originalFamily` if a Google Fonts variant has a slightly different
   * registered family).
   */
  resolvedFamily: string;
  /** How this font was resolved. */
  source: FontResolutionSource;
  /**
   * Absolute path to the .ttf/.otf file on disk. Always set; fallbacks
   * resolve to one of the shipped fonts.
   */
  fontPath: string;
  /**
   * For `source: 'google-fonts'` entries: the public URL the font was
   * downloaded from (for cache invalidation / audit). Omitted for shipped
   * and fallback entries.
   */
  sourceUrl?: string;
}

export type FontManifest = FontManifestEntry[];
