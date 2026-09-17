import { RETIRED_SHAPES } from './briefs.js';
import { SINGLE_TEMPLATES } from './single-registry.js';
import type { SingleTemplate, TemplateUsageType } from './types.js';

/**
 * Deterministic template selection.
 *
 * Picks a curated template from the registry by hashing a seed (the graphicId).
 * Deterministic so a given graphic always maps to the same template (stable
 * re-runs), while a batch of different graphics spreads across templates for
 * variety. Filtered by `usageType` so an organic render only ever picks an
 * organic template, and an ad render only an ad (offer) template. v1 is
 * content-agnostic rotation within the pool; selecting by service tags is a
 * follow-up.
 */
/**
 * Templates that may still be RENDERED (a pinned regeneration resolves them)
 * but are never freshly SELECTED.
 *
 * `testimonial-quote` asks for a client's first name and a five-star rating and
 * generation has no source of real ones, so every render invents a customer AND
 * a review of a business it has never seen. `poll-thisorthat` exists to produce
 * a vote instruction, which is exactly what `RULE_NO_SOCIAL_CHROME` strips.
 * Both shipped their defect in production; neither is fixable by rewording,
 * because in each case the SUBJECT is the problem. See `semantic-briefs.ts`.
 */
function selectableSingles(usageType: TemplateUsageType) {
  return SINGLE_TEMPLATES.filter(
    (t) =>
      t.usageType === usageType &&
      !(RETIRED_SHAPES as readonly string[]).includes(t.slug)
  );
}

function hash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function selectSingleTemplateSlug(
  seed: string,
  usageType: TemplateUsageType = 'organic'
): string {
  const pool = selectableSingles(usageType);
  const effective = pool.length > 0 ? pool : SINGLE_TEMPLATES;
  return effective[hash(seed) % effective.length].slug;
}

export { rotateTemplateSlugs } from './rotate.js';

/**
 * The single-template slugs available for a usage type, in registry order.
 * Exposed so the planner can rotate across them by position instead of
 * hashing a random id per graphic.
 */
export function singleTemplateSlugs(
  usageType: TemplateUsageType = 'organic'
): string[] {
  const pool = selectableSingles(usageType);
  const effective = pool.length > 0 ? pool : SINGLE_TEMPLATES;
  return effective.map((t: SingleTemplate) => t.slug);
}
