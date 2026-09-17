import { z } from 'zod';

/**
 * A FIXED colourway vocabulary.
 *
 * Free text fragmented one brand's single house style seven ways — "green and
 * white", "white and green", "light green and white", "mint green and white"
 * and "sage green and white" were all the same look, and the split let a
 * four-post seasonal campaign outrank it. Grouping only works when the label
 * comes from a closed set.
 */
export const inspirationColourways = [
  'light-ground',
  'dark-ground',
  'brand-colour-ground',
  'photo-led',
] as const;
export type InspirationColourway = (typeof inspirationColourways)[number];

/**
 * A FIXED layout vocabulary, for the same reason. Colourway alone says what a
 * post is coloured like, not how it is built; two posts can share a cream
 * ground and still be nothing alike.
 */
export const inspirationLayouts = [
  'type-led-panel',
  'photo-with-text-overlay',
  'split-or-two-up',
  'card-over-photo',
  'minimal-type',
] as const;
export type InspirationLayout = (typeof inspirationLayouts)[number];

/** What the gate decided about one post. Cached on the corpus row. */
export const inspirationVerdictSchema = z.object({
  kind: z.string().min(1),
  isDesign: z.boolean(),
  colourway: z.enum(inspirationColourways),
  layout: z.enum(inspirationLayouts),
  /** `colourway|layout` — the stored grouping key. */
  designFamily: z.string().min(1),
  usable: z.boolean(),
  /**
   * Does the brand mark in this post match the org's UPLOADED logo?
   *
   * `absent` when the post carries no mark, which is harmless. `different`
   * means the post shows another lockup entirely — a sub-brand, a retired mark,
   * or someone else's — and using it as a reference teaches the model the wrong
   * logo.
   *
   * This is the ROOT of the "logo keeps changing" complaint. One org's three
   * selected references were two posts carrying `Skin from Brazil / EXCLUSIVE
   * PRODUCT` (their product range) and one carrying `Skin From Brazil /
   * AESTHETICS` (the clinic, and the uploaded asset). The model saw the wrong
   * mark twice and the right one once and produced a blend. No amount of
   * prompt wording fixes a contradiction in the inputs.
   *
   * Optional because rows gated before this existed have no value, and because
   * an org with no logo on file has nothing to compare against.
   */
  logoMatch: z.enum(['match', 'different', 'absent']).optional(),
  /**
   * How good this post is AS A DESIGN TO IMITATE, 0-5.
   *
   * `usable` is a blacklist — it rejects the genres somebody thought to
   * enumerate, and everything else passes. That is how a "VOTE FOR US — Best of
   * Georgia Nominee" plea and a "TODAY'S THE DAY, our new laser machine is
   * here" event announcement became two of the three references a whole day's
   * renders were built from: neither is a price change, a closure notice, a
   * hiring ad or a testimonial card, so neither matched the enumeration.
   *
   * A blacklist cannot anticipate genres. A score can rank, so selection stops
   * asking "is this not-forbidden?" and starts asking "is this the BEST thing
   * this brand has made?".
   *
   * Optional because rows gated before this existed have no score, and a
   * missing score must not silently read as zero.
   */
  suitability: z.number().int().min(0).max(5).optional(),
  reason: z.string().optional(),
});
export type InspirationVerdict = z.infer<typeof inspirationVerdictSchema>;

export const gateInspirationCandidatesSchema = z.object({
  organizationId: z.string().min(1, 'organizationId required'),
  /** Re-gate rows that already carry a verdict (after a prompt change). */
  force: z.boolean().default(false),
  /** Cap on rows classified in one run — the gate costs one call per 8. */
  limit: z.number().int().min(1).max(500).default(200),
});
export type GateInspirationCandidatesInput = z.input<
  typeof gateInspirationCandidatesSchema
>;

export const selectInspirationSetSchema = z.object({
  organizationId: z.string().min(1, 'organizationId required'),
  /** How many references one render gets. Three worked well in testing. */
  setSize: z.number().int().min(1).max(6).default(3),
  /** Force a colourway instead of taking the house style. */
  colourway: z.enum(inspirationColourways).optional(),
});
export type SelectInspirationSetInput = z.input<
  typeof selectInspirationSetSchema
>;
