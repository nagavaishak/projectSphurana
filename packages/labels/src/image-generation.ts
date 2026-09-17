/**
 * Image generation (nano banana) enums - Pure TypeScript (no Drizzle imports)
 * Must stay in sync with schema/image-template.ts, image-render-batch.ts,
 * image-render-request.ts.
 *
 * The image generation feature renders carousels and single images via the
 * Gemini 2.5 Flash Image (nano banana) batch API. Templates are the logical
 * layouts; batches track one submission to the provider; requests are the
 * per-slide entries inside a batch.
 */

// =============================================================================
// IMAGE TEMPLATE KIND
// One template family produces a multi-slide carousel; the other produces a
// single-image graphic. Surfaced on `image_template.kind` and used by the
// dispatcher to pick the right detail planner.
// =============================================================================

export const imageTemplateKindLabels = {
  carousel: 'Carousel',
  single: 'Single',
} as const;

export const imageTemplateKindValues = Object.keys(imageTemplateKindLabels) as [
  keyof typeof imageTemplateKindLabels,
  ...(keyof typeof imageTemplateKindLabels)[],
];

export type ImageTemplateKind = keyof typeof imageTemplateKindLabels;

// =============================================================================
// GRAPHIC CATEGORY
// Editorial axis applied to every `image_template`. The planner filters
// templates by `(kind, category)` at graphic-generation time so the user's
// choice of category constrains which layouts are eligible. New categories
// are added here — each must also be reflected in the `image_template.category`
// pgEnum (derived from this record's keys).
// =============================================================================

export const graphicCategoryLabels = {
  tips: 'Tips',
  motivation: 'Motivation',
  question: 'Question',
  storyline: 'Storyline',
} as const;

export const graphicCategoryValues = Object.keys(graphicCategoryLabels) as [
  keyof typeof graphicCategoryLabels,
  ...(keyof typeof graphicCategoryLabels)[],
];

export type GraphicCategory = keyof typeof graphicCategoryLabels;

// =============================================================================
// IMAGE RENDER BATCH STATUS
// Lifecycle of one submission to the nano banana batch API.
//
// submitted -> row created, provider job submitted, polling pending
// running   -> provider acknowledged, work in progress
// completed -> all slide renders finished successfully
// failed    -> provider job failed before producing any outputs
// partial   -> provider job finished with some failures (partial outputs)
// =============================================================================

export const imageRenderBatchStatusLabels = {
  submitted: 'Submitted',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  partial: 'Partial',
} as const;

export const imageRenderBatchStatusValues = Object.keys(
  imageRenderBatchStatusLabels
) as [
  keyof typeof imageRenderBatchStatusLabels,
  ...(keyof typeof imageRenderBatchStatusLabels)[],
];

export type ImageRenderBatchStatus = keyof typeof imageRenderBatchStatusLabels;

// =============================================================================
// SLOT VOCABULARY KIND
// Selects which slot-id dictionary the AI vision labeler uses when assigning
// shape → slot mappings during PPTX import. Each kind corresponds to a known
// template family (e.g. 8-slide tips carousel) with its own slot vocabulary
// (coverHeadline, tipTitle, brandFooter, …). The generic `unknown` vocabulary
// is the safe default for one-off layouts.
// =============================================================================

export const slotVocabularyKindLabels = {
  'tips-carousel-8': 'Tips carousel (8 slides)',
  unknown: 'Generic',
} as const;

export const slotVocabularyKindValues = Object.keys(
  slotVocabularyKindLabels
) as [
  keyof typeof slotVocabularyKindLabels,
  ...(keyof typeof slotVocabularyKindLabels)[],
];

export type SlotVocabularyKind = keyof typeof slotVocabularyKindLabels;
