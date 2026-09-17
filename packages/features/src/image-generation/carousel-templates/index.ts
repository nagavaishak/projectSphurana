export type { SingleTemplate, TemplateUsageType } from './types.js';
export { SINGLE_TEMPLATES, getSingleTemplate } from './single-registry.js';
export { type InspirationImage, loadSingleInspiration } from './load.js';
export {
  rotateTemplateSlugs,
  selectSingleTemplateSlug,
  singleTemplateSlugs,
} from './select.js';
/**
 * BRIEFS ARE THE LAYOUT SOURCE FOR ORGANIC WORK.
 *
 * `semantic-briefs.ts` is gone with the composition registry it superseded;
 * `briefs.ts` carries the same subjects with slugs, so they can be pinned,
 * persisted and offered in the picker. Ads keep composition templates —
 * `SINGLE_TEMPLATES` — because a price badge in a fixed position is a real
 * layout requirement rather than a description of a look.
 */
export * from './briefs.js';
