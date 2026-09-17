import {
  generateOrganicCopyRequestBase,
  organicVariationIdRequestSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Variation IDs accepted by the organic-copy generator.
 *
 * DERIVED from the wire contract — see `organicVariationIdRequestSchema` in
 * `packages/contracts/src/requests/content.ts`, which explains why this list is
 * kept in sync with the remotion templates by hand.
 */
export const organicVariationIdSchema = organicVariationIdRequestSchema;

export type OrganicVariationId = z.infer<typeof organicVariationIdSchema>;

/**
 * DERIVED from the wire contract — see `generateOrganicCopyRequestBase` in
 * `packages/contracts/src/requests/content.ts`.
 */
export const generateOrganicCopySchema = generateOrganicCopyRequestBase.extend({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GenerateOrganicCopyInput = z.infer<
  typeof generateOrganicCopySchema
>;

/**
 * Per-variation output schemas. Each maps 1:1 to the matching config block
 * on `VideoConfig` in the remotion package.
 */
// Models sometimes emit `null` for fields the prompt says are optional, even
// when we ask them to omit the key. `.nullish()` accepts both null and
// undefined; the service normalizes the result to undefined before returning.
export const captionTeaseCopySchema = z.object({
  headline: z.string().min(1).max(160),
  emphasis: z.string().min(1).max(40).nullish(),
  emoji: z.string().min(1).max(8).nullish(),
  caption: z.string().min(1).max(40),
});

export const fadeBenefitsCopySchema = z.object({
  lines: z.array(z.string().min(1).max(60)).min(2).max(5),
});

export const aestheticLineCopySchema = z.object({
  // Keep it short — roughly "this & thinking about nothing" length.
  text: z.string().min(1).max(32),
});

export const numberedListCopySchema = z.object({
  title: z.string().min(1).max(60),
  items: z.array(z.string().min(1).max(40)).min(3).max(6),
});

export const insOutsCopySchema = z.object({
  title: z.string().min(1).max(48),
  insLabel: z.string().min(1).max(12).nullish(),
  insItems: z.array(z.string().min(1).max(40)).min(3).max(10),
  outsLabel: z.string().min(1).max(12).nullish(),
  outsItems: z.array(z.string().min(1).max(40)).min(3).max(10),
});

export const questionCtaCopySchema = z.object({
  question: z.string().min(1).max(80),
  ctaText: z.string().min(1).max(40),
});

export const improvesCopySchema = z.object({
  serviceName: z.string().min(1).max(40),
  items: z.array(z.string().min(1).max(28)).min(2).max(5),
  ctaText: z.string().min(1).max(80),
});

export const stepTimerCopySchema = z.object({
  title: z.string().min(1).max(60),
  steps: z
    .array(
      z.object({
        label: z.string().min(1).max(32),
        duration: z.string().min(1).max(16),
      })
    )
    .min(2)
    .max(5),
});

export const pollCopySchema = z.object({
  question: z.string().min(1).max(90),
  likeLabel: z.string().min(1).max(36),
  commentLabel: z.string().min(1).max(36),
  shareLabel: z.string().min(1).max(36).nullish(),
});

export const mythFactCopySchema = z.object({
  seriesTitle: z.string().min(1).max(24).nullish(),
  pairs: z
    .array(
      z.object({
        myth: z.string().min(1).max(90),
        fact: z.string().min(1).max(120),
      })
    )
    .min(1)
    .max(3),
  ctaText: z.string().min(1).max(40).nullish(),
});

export const versusCopySchema = z.object({
  treatmentA: z.string().min(1).max(14),
  treatmentB: z.string().min(1).max(14),
  rounds: z
    .array(
      z.object({
        label: z.string().min(1).max(12),
        aValue: z.string().min(1).max(45),
        bValue: z.string().min(1).max(45),
      })
    )
    .min(2)
    .max(4),
  verdict: z.string().min(1).max(100),
});

export const priceRevealCopySchema = z.object({
  hook: z.string().min(1).max(70),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(28),
        price: z.string().min(1).max(9),
      })
    )
    .min(2)
    .max(5),
  totalPrice: z.string().min(1).max(9),
  valueLine: z.string().min(1).max(60).nullish(),
});

export const clientQuestionCopySchema = z.object({
  question: z.string().min(1).max(110),
  asker: z.string().min(1).max(14),
  answers: z.array(z.string().min(1).max(80)).min(2).max(5),
  ctaText: z.string().min(1).max(60).nullish(),
});

export const comeWithMeCopySchema = z.object({
  title: z.string().min(1).max(60),
  seriesChip: z.string().min(1).max(12).nullish(),
  steps: z.array(z.string().min(1).max(45)).min(3).max(7),
  closingCta: z.string().min(1).max(50),
});

export const timeProgressCopySchema = z.object({
  startLabel: z.string().min(1).max(20),
  endLabel: z.string().min(1).max(20),
  caption: z.string().min(1).max(48),
});

/**
 * Discriminated union of all possible organic-copy results. The frontend
 * inspects `kind` to know which `config` shape it received.
 */
export type GeneratedOrganicCopy =
  | { kind: 'caption-tease'; config: z.infer<typeof captionTeaseCopySchema> }
  | { kind: 'fade-benefits'; config: z.infer<typeof fadeBenefitsCopySchema> }
  | {
      kind: 'highlight-caption';
      config: z.infer<typeof fadeBenefitsCopySchema>;
    }
  | { kind: 'aesthetic-line'; config: z.infer<typeof aestheticLineCopySchema> }
  | { kind: 'numbered-list'; config: z.infer<typeof numberedListCopySchema> }
  | { kind: 'ins-outs'; config: z.infer<typeof insOutsCopySchema> }
  | { kind: 'question-cta'; config: z.infer<typeof questionCtaCopySchema> }
  | { kind: 'curiosity-hook'; config: z.infer<typeof questionCtaCopySchema> }
  | { kind: 'improves'; config: z.infer<typeof improvesCopySchema> }
  | { kind: 'step-timer'; config: z.infer<typeof stepTimerCopySchema> }
  | { kind: 'time-progress'; config: z.infer<typeof timeProgressCopySchema> }
  | { kind: 'poll'; config: z.infer<typeof pollCopySchema> }
  | { kind: 'myth-fact'; config: z.infer<typeof mythFactCopySchema> }
  | { kind: 'versus'; config: z.infer<typeof versusCopySchema> }
  | { kind: 'price-reveal'; config: z.infer<typeof priceRevealCopySchema> }
  | {
      kind: 'client-question';
      config: z.infer<typeof clientQuestionCopySchema>;
    }
  | { kind: 'come-with-me'; config: z.infer<typeof comeWithMeCopySchema> };
