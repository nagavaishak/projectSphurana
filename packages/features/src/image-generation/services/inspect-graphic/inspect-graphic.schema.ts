import { z } from 'zod';

/**
 * `blocker` — an owner would refuse to publish this.
 * `warning`  — noticeable but publishable.
 */
export const graphicDefectSeverities = ['blocker', 'warning'] as const;

export const graphicDefectSchema = z.object({
  severity: z.enum(graphicDefectSeverities),
  /** Short slug, e.g. `duplicated-text`, `clipped-text`, `social-chrome`. */
  kind: z.string().min(1),
  /** What and where, quoting the text when it is a text fault. */
  detail: z.string().min(1),
});
export type GraphicDefect = z.infer<typeof graphicDefectSchema>;

export const inspectGraphicSchema = z.object({
  /** The rendered PNG. Downscaled before it reaches the model. */
  png: z.instanceof(Buffer),
  /**
   * Whether the org opted into AI-generated imagery.
   *
   * This does NOT change what the gate looks for. The vision prompt is
   * identical either way, so two configurations produce comparable
   * observations — see `observed` on the result. It only decides SEVERITY
   * afterwards: an invented person the org asked for is a warning rather than
   * a blocker (otherwise it was ~7 of 11 blockers in testing, enough noise to
   * get the whole gate switched off). A FABRICATED BEFORE/AFTER PAIR stays a
   * blocker regardless: that is a claim about treatment results, not a
   * stylistic choice.
   */
  allowAiImages: z.boolean().default(false),
  /** Slide number for a carousel, so the report says which slide. */
  slideOrder: z.number().int().min(0).optional(),
  /**
   * The org's real logo, shown to the gate alongside the render.
   *
   * Without it the gate can only spot a logo that is missing, stretched or
   * duplicated — it cannot see a RE-TYPESET one, because it has nothing to
   * compare against. That is the defect that matters: two renders from the same
   * template and the same inputs produced her actual script lockup on one and
   * the business name in plain spaced capitals on the other. The failure is
   * sampling variance, so no prompt wording removes it — it has to be caught
   * and re-rolled, which is what this gate already does for text defects.
   */
  brandLogo: z.instanceof(Buffer).optional(),
  /**
   * Whether this graphic is SUPPOSED to carry the brand mark.
   *
   * Carousel slides other than the cover deliberately carry none, so "the logo
   * is missing" stops being a defect there and its PRESENCE becomes one. Left
   * true this gate flagged 8 of 9 slides in a deck built exactly as intended,
   * and in `enforce` mode would have re-rolled every one of them — the same
   * shape of self-inflicted bug as the templates asking for pagination dots
   * that this gate then failed them for.
   */
  expectLogo: z.boolean().default(true),
});
export type InspectGraphicInput = z.input<typeof inspectGraphicSchema>;
