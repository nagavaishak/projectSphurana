import { z } from 'zod';

/**
 * What the judge can say about a mark.
 *
 * Every value except `correct` names a SPECIFIC failure, because the verdict is
 * fed back to the model as a correction and "the logo is wrong" is not an
 * instruction. `re-typeset` and `recoloured-container` in particular need
 * different fixes: one means "you drew type instead of the mark", the other
 * means "you kept the mark but invented its container".
 */
export const logoVerdictLabels = {
  correct: 'Matches the brand mark',
  're-typeset': 'Business name set in an ordinary font instead of the mark',
  substituted: "A DIFFERENT icon or container from the brand's own",
  distorted: 'The mark, but stretched, squashed, garbled or misspelled',
  'recoloured-container': 'The mark on a container colour it does not have',
  absent: 'No mark and no business name anywhere',
  duplicated: 'The mark appears more than once',
} as const;

export const logoVerdictValues = Object.keys(
  logoVerdictLabels
) as (keyof typeof logoVerdictLabels)[];

export type LogoVerdict = keyof typeof logoVerdictLabels;

export const judgeLogoSchema = z.object({
  /** The rendered graphic. Downscaled before it reaches the model. */
  png: z.instanceof(Buffer),
  /**
   * The org's real logo. REQUIRED — unlike the general gate, this judge has
   * exactly one job and cannot do it without something to compare against.
   * A re-typeset mark is only visible side by side.
   */
  brandLogo: z.instanceof(Buffer),
  /** Slide number for a carousel, so the report says which slide. */
  slideOrder: z.number().int().min(0).optional(),
});

export type JudgeLogoInput = z.input<typeof judgeLogoSchema>;
