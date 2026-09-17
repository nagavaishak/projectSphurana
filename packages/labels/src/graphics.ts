/**
 * Graphics enums - Pure TypeScript (no Drizzle imports)
 * Must stay in sync with schema/graphic.ts and schema/graphic-template.ts
 */

// Graphic template category labels
export const graphicTemplateCategoryLabels = {
  credibility: 'Credibility',
  hook_claim: 'Hook + Claim',
  offer: 'Offer',
  qa_mythbuster: 'Q&A / Myth-Buster',
  testimonial: 'Testimonial',
} as const;

export const graphicTemplateCategoryValues = Object.keys(
  graphicTemplateCategoryLabels
) as [
  keyof typeof graphicTemplateCategoryLabels,
  ...(keyof typeof graphicTemplateCategoryLabels)[],
];

export type GraphicTemplateCategory =
  keyof typeof graphicTemplateCategoryLabels;

// Aspect ratio labels
export const aspectRatioLabels = {
  '1:1': 'Square (1:1)',
  '9:16': 'Portrait (9:16)',
  '16:9': 'Landscape (16:9)',
  '4:5': 'Instagram Portrait (4:5)',
  '4:3': 'Standard (4:3)',
  '1.91:1': '1.91:1 (LinkedIn)',
} as const;

export const aspectRatioValues = Object.keys(aspectRatioLabels) as [
  keyof typeof aspectRatioLabels,
  ...(keyof typeof aspectRatioLabels)[],
];

export type AspectRatio = keyof typeof aspectRatioLabels;

// Graphic status labels
export const graphicStatusLabels = {
  draft: 'Draft',
  rendering: 'Rendering',
  ready: 'Ready',
  failed: 'Failed',
} as const;

export const graphicStatusValues = Object.keys(graphicStatusLabels) as [
  keyof typeof graphicStatusLabels,
  ...(keyof typeof graphicStatusLabels)[],
];

export type GraphicStatus = keyof typeof graphicStatusLabels;

// Usage type — distinguishes graphics intended for paid ads from organic
// social posts. Existing rows default to 'ad' (the original use case).
// Organic graphics are produced by the monthly bulk batch flow and use
// different template families authored under feat/graphics.
export const graphicUsageTypeLabels = {
  ad: 'Ad',
  organic: 'Organic',
} as const;

export const graphicUsageTypeValues = Object.keys(graphicUsageTypeLabels) as [
  keyof typeof graphicUsageTypeLabels,
  ...(keyof typeof graphicUsageTypeLabels)[],
];

export type GraphicUsageType = keyof typeof graphicUsageTypeLabels;

// =============================================================================
// CONTENT IDEAS
// =============================================================================

export const contentIdeaKindLabels = {
  offer: 'Offer',
  qa: 'Q&A',
  tip: 'Tip',
  storytime: 'Storytime',
  informative: 'Informative',
  testimonial: 'Testimonial',
  credibility: 'Credibility',
  hook_claim: 'Hook + Claim',
  custom: 'Custom',
} as const;

export const contentIdeaKindValues = Object.keys(contentIdeaKindLabels) as [
  keyof typeof contentIdeaKindLabels,
  ...(keyof typeof contentIdeaKindLabels)[],
];

export type ContentIdeaKind = keyof typeof contentIdeaKindLabels;

// =============================================================================
// TEMPLATE DENSITY
// =============================================================================

export const graphicTemplateDensityLabels = {
  text_heavy: 'Text Heavy',
  image_heavy: 'Image Heavy',
  balanced: 'Balanced',
} as const;

export const graphicTemplateDensityValues = Object.keys(
  graphicTemplateDensityLabels
) as [
  keyof typeof graphicTemplateDensityLabels,
  ...(keyof typeof graphicTemplateDensityLabels)[],
];

export type GraphicTemplateDensity = keyof typeof graphicTemplateDensityLabels;

// =============================================================================
// TEMPLATE PLACEHOLDER CONTRACT
// Stored on `graphic_template.placeholder_contract` jsonb.
// Keep these values in lockstep with the semantic format spec §5.5 / §8.2.
// =============================================================================

export const templatePlaceholderKindLabels = {
  text: 'Text',
  long_text: 'Long Text',
  image: 'Image',
  color: 'Color',
  logo: 'Logo',
  stat: 'Stat',
  cta: 'Call to Action',
} as const;

export const templatePlaceholderKindValues = Object.keys(
  templatePlaceholderKindLabels
) as [
  keyof typeof templatePlaceholderKindLabels,
  ...(keyof typeof templatePlaceholderKindLabels)[],
];

export type TemplatePlaceholderKind =
  keyof typeof templatePlaceholderKindLabels;

export const templatePlaceholderRoleLabels = {
  headline: 'Headline',
  subhead: 'Subhead',
  body: 'Body',
  caption: 'Caption',
  cta: 'Call to Action',
  meta: 'Meta',
} as const;

export const templatePlaceholderRoleValues = Object.keys(
  templatePlaceholderRoleLabels
) as [
  keyof typeof templatePlaceholderRoleLabels,
  ...(keyof typeof templatePlaceholderRoleLabels)[],
];

export type TemplatePlaceholderRole =
  keyof typeof templatePlaceholderRoleLabels;

// =============================================================================
// TEMPLATE FAMILY — per-platform role
// Locked to the seven v1 size presets + `custom` (see graphics.md §2
// "Multi-size graphics"). Do not expand without an explicit architecture
// decision — UIs and the Figma importer key off this list.
// =============================================================================

export const graphicTemplateFamilyRoleLabels = {
  instagram_post: 'Instagram Post (1:1)',
  instagram_story: 'Instagram Story (9:16)',
  instagram_portrait: 'Instagram Portrait (4:5)',
  linkedin_post: 'LinkedIn Post (1.91:1)',
  facebook_post: 'Facebook Post (4:5)',
  twitter_post: 'Twitter / X (16:9)',
  tiktok: 'TikTok (9:16)',
  custom: 'Custom',
} as const;

export const graphicTemplateFamilyRoleValues = Object.keys(
  graphicTemplateFamilyRoleLabels
) as [
  keyof typeof graphicTemplateFamilyRoleLabels,
  ...(keyof typeof graphicTemplateFamilyRoleLabels)[],
];

export type GraphicTemplateFamilyRole =
  keyof typeof graphicTemplateFamilyRoleLabels;

// =============================================================================
// SHADOW RENDER — Track 14
// Status lifecycle for a single diff row in `graphic_shadow_render`. A row is
// born `pending` (matched) or `drift` (unmatched); human triage transitions
// `drift → acknowledged | bug`. Stored via the labels-record pattern so the
// admin dashboard consumes display text without a separate mapping.
// =============================================================================

export const graphicShadowRenderStatusLabels = {
  pending: 'Pending',
  drift: 'Drift detected',
  acknowledged: 'Acknowledged (expected drift)',
  bug: 'Renderer bug',
} as const;

export const graphicShadowRenderStatusValues = Object.keys(
  graphicShadowRenderStatusLabels
) as [
  keyof typeof graphicShadowRenderStatusLabels,
  ...(keyof typeof graphicShadowRenderStatusLabels)[],
];

export type GraphicShadowRenderStatus =
  keyof typeof graphicShadowRenderStatusLabels;

// =============================================================================
// AI GENERATION — Track 19 Week 3
// Status + model labels for `graphic_generation_event` rows. One row per
// `POST /graphics/generate` call; the orchestrator writes before returning
// regardless of outcome so per-user / per-org cost caps can aggregate both
// successful and failed attempts (a rate-limited call doesn't count against
// the spend cap — its `costUsd` is zero — but it still audits).
// =============================================================================

export const graphicGenerationEventStatusLabels = {
  success: 'Success',
  validation_failed: 'Validation failed',
  rate_limited: 'Rate limited',
  refused: 'Model refused',
  error: 'Error',
} as const;

export const graphicGenerationEventStatusValues = Object.keys(
  graphicGenerationEventStatusLabels
) as [
  keyof typeof graphicGenerationEventStatusLabels,
  ...(keyof typeof graphicGenerationEventStatusLabels)[],
];

export type GraphicGenerationEventStatus =
  keyof typeof graphicGenerationEventStatusLabels;

export const aiGenerationModelLabels = {
  'sonnet-4.6': 'Claude Sonnet 4.6',
  'opus-4.7': 'Claude Opus 4.7',
} as const;

export const aiGenerationModelValues = Object.keys(aiGenerationModelLabels) as [
  keyof typeof aiGenerationModelLabels,
  ...(keyof typeof aiGenerationModelLabels)[],
];

export type AiGenerationModel = keyof typeof aiGenerationModelLabels;
