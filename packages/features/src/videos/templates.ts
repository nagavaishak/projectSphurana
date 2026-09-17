// Client-safe video template data (no server-side dependencies)
// Use this entry point in frontend apps to avoid pulling in server-side code
export {
  CONTENT_IDEA_TEMPLATES,
  RETIRED_TEMPLATE_IDS,
  SHARED_MUSIC_TRACKS,
  getSelectableTemplates,
  getTemplateById,
  getRandomVariation,
  getVariationById,
  isRetiredTemplate,
  selectRandomVariationForTemplate,
  type ContentIdeaTemplate,
  type TemplateMusicTrack,
  type TemplateVariation,
  type TemplateClipGuidance,
  type TemplateRenderingConfig,
} from './templates/index.js';
