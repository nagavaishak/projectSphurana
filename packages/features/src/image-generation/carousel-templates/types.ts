/**
 * Curated carousel template registry types.
 *
 * A `CarouselTemplate` is one of the hand-curated example carousels, broken
 * down slide-by-slide. Each slide carries:
 *   - `layoutPrompt`  the SET PROMPT for that slide's inspiration image: the
 *                     structural layout to reproduce, FULLY rebranded (the
 *                     example's own colours / logo / wording are replaced by
 *                     the target brand + the orchestrator's copy).
 *   - `copySpec`      how the copy for this slide should read — style + the
 *                     approximate word count + structure, copied from the
 *                     example. The orchestrator writes the actual words to
 *                     this spec for the given service/topic.
 *   - the inspiration image itself lives in S3 (resolved by template slug +
 *     slide index — see `carouselInspirationUrl`), never committed.
 *
 * The orchestrator coordinates the whole post (one planning call → coherent
 * copy deck), then generates each slide from its `layoutPrompt` + that slide's
 * planned copy + the brand inputs.
 */

export interface CarouselSlideTemplate {
  /** Human label for the slide's role in the narrative (hook, proof, cta…). */
  role: string;
  /** SET PROMPT: structural layout to reproduce, rebranded. No example brand. */
  layoutPrompt: string;
  /** Copy style + length + structure for this slide (the orchestrator fills). */
  copySpec: string;
  /**
   * When true, do NOT feed this slide the org's real uploaded service media as
   * the subject photo. Set on brand/text CTA slides so the model can't drop the
   * org's real photo (often the owner's headshot) into a "portrait" area. The
   * layout must be type-and-brand only. Defaults to false (subject photo used).
   */
  noSubjectPhoto?: boolean;
  /**
   * What this slide SITS ON, and therefore whether it can be built as an edit.
   *
   *   `flat`       — a flat ground with no photograph. The ground is a value
   *                  the deck must hold, so this slide is produced by EDITING a
   *                  sibling that already has it.
   *   `flat-photo` — a flat ground with a CONTAINED photograph on it. Still an
   *                  edit: the ground is real and preservable, and the photo is
   *                  an element inside it rather than the ground itself.
   *   `bleed`      — a photograph fills the frame. There is no flat ground to
   *                  carry, and editing a sibling would force it to reuse that
   *                  sibling's photograph, so this slide is GENERATED.
   *
   * DECLARED, NOT INFERRED. This could be pattern-matched from `layoutPrompt`
   * — "a flat background, NO photograph" is right there in the prose — and that
   * is exactly how it would rot: reword a brief and a slide silently changes
   * class with nothing to catch it. The mixed-ground defects in this registry
   * got in that way, invisible until measured.
   *
   * Unset means `bleed`, because generating a slide that could have been an
   * edit costs consistency, while editing one that should have been generated
   * makes it reuse a photograph — the worse of the two failures.
   */
  ground?: 'flat' | 'flat-photo' | 'bleed';
  /**
   * Show the brand MARK on this slide. Defaults to FALSE — opt in, never out.
   *
   * Every slide carrying the mark is another chance to render it wrong, and a
   * deck stamping it on all six slides was taking that chance six times for no
   * design benefit; real brand carousels do not repeat the mark on every slide.
   * Cover slides and brand/CTA cards opt in — the mark IS the content there.
   *
   * The default is false rather than true so that FORGETTING the flag yields a
   * slide with no logo instead of a slide with a wrong one, which is the way
   * round this should fail.
   *
   * On a deck this pairs with anchoring: the cover is rendered first and put
   * through `inspectGraphic` before the other slides fan out, so the one slide
   * that carries the mark is the one slide already being inspected and
   * re-rolled.
   */
  showLogo?: boolean;
}

/**
 * Which surface a template is for. `organic` = social-feed posts (the default
 * library), `ad` = paid offer ads (an offer-led layout with a price/discount
 * badge + CTA). Selection filters the registry by this so an ad render never
 * picks an organic template and vice-versa. Mirrors `graphic.usageType`.
 */
export type TemplateUsageType = 'organic' | 'ad';

export interface CarouselTemplate {
  /** Stable slug — also the S3 inspiration-image folder. */
  slug: string;
  label: string;
  /** When this template fits — drives selection + the planner's framing. */
  description: string;
  aspectRatio: string;
  /** Free tags for selection (service kinds, post styles). */
  tags: string[];
  /** organic = social post, ad = paid offer ad. Filters template selection. */
  usageType: TemplateUsageType;
  slides: CarouselSlideTemplate[];
}

/**
 * A single-graphic template — one curated example post broken down into its
 * layout set-prompt + copy-spec. Same idea as one carousel slide, but it
 * stands alone. Its inspiration image lives in S3 at
 * `carousel-inspiration/_single/<slug>.jpg`.
 */
export interface SingleTemplate {
  slug: string;
  label: string;
  description: string;
  aspectRatio: string;
  tags: string[];
  /** organic = social post, ad = paid offer ad. Filters template selection. */
  usageType: TemplateUsageType;
  layoutPrompt: string;
  copySpec: string;
}
