import type {
  AestheticLineDraftConfig,
  CaptionTeaseDraftConfig,
  ClientQuestionDraftConfig,
  ComeWithMeDraftConfig,
  FadeBenefitsDraftConfig,
  ImprovesDraftConfig,
  InsOutsDraftConfig,
  MythFactDraftConfig,
  NumberedListDraftConfig,
  PollDraftConfig,
  PriceRevealDraftConfig,
  QuestionCtaDraftConfig,
  StepTimerDraftConfig,
  TimeProgressDraftConfig,
  VersusDraftConfig,
} from '@borradh-workspace/database';
import type { GeneratedOrganicCopy } from './generate-organic-copy.schema.js';

/**
 * The organic-template-specific block of a video draft config. Exactly one
 * key is populated per draft, gated by the template's variation. Mirrors the
 * organic fields on `VideoDraftConfig`, so the result can be spread directly
 * into either the database draft-config type or the zod `DraftConfig`.
 */
export interface OrganicDraftConfigBlock {
  captionTease?: CaptionTeaseDraftConfig;
  fadeBenefits?: FadeBenefitsDraftConfig;
  aestheticLine?: AestheticLineDraftConfig;
  numberedList?: NumberedListDraftConfig;
  insOuts?: InsOutsDraftConfig;
  questionCta?: QuestionCtaDraftConfig;
  improves?: ImprovesDraftConfig;
  stepTimer?: StepTimerDraftConfig;
  timeProgress?: TimeProgressDraftConfig;
  poll?: PollDraftConfig;
  mythFact?: MythFactDraftConfig;
  versus?: VersusDraftConfig;
  priceReveal?: PriceRevealDraftConfig;
  clientQuestion?: ClientQuestionDraftConfig;
  comeWithMe?: ComeWithMeDraftConfig;
}

/**
 * Map an AI-generated organic copy result to the matching draft-config block.
 *
 * The AI schema uses `.nullish()` for optional fields, but the draft config
 * types are `string | undefined` only — coerce `null` → `undefined` here so
 * the model's literal `null` never leaks into the renderer.
 *
 * Shared by the monthly-batch path (`planVideoDetail`) and the one-prompt
 * creation path (the videos controller, used by Claire) so organic drafts
 * are assembled identically regardless of entry point.
 */
export function organicCopyToConfigBlock(
  copy: GeneratedOrganicCopy
): OrganicDraftConfigBlock {
  switch (copy.kind) {
    case 'caption-tease':
      return {
        captionTease: {
          headline: copy.config.headline,
          caption: copy.config.caption,
          emphasis: copy.config.emphasis ?? undefined,
          emoji: copy.config.emoji ?? undefined,
        },
      };
    case 'ins-outs':
      return {
        insOuts: {
          title: copy.config.title,
          insItems: copy.config.insItems,
          outsItems: copy.config.outsItems,
          insLabel: copy.config.insLabel ?? undefined,
          outsLabel: copy.config.outsLabel ?? undefined,
        },
      };
    case 'fade-benefits':
      return { fadeBenefits: { lines: copy.config.lines } };
    case 'highlight-caption':
      // Reuses the fade-benefits render path; `highlight` switches the layer to
      // the solid brand-colour block treatment.
      return { fadeBenefits: { lines: copy.config.lines, highlight: true } };
    case 'aesthetic-line':
      return { aestheticLine: copy.config };
    case 'numbered-list':
      return { numberedList: copy.config };
    case 'question-cta':
      return { questionCta: copy.config };
    case 'curiosity-hook':
      // Reuses the question-cta render path (top claim + bottom CTA line).
      return { questionCta: copy.config };
    case 'improves':
      return { improves: copy.config };
    case 'step-timer':
      return { stepTimer: copy.config };
    case 'time-progress':
      return { timeProgress: copy.config };
    case 'poll':
      // Coerce the model's `null` shareLabel → undefined for the draft type.
      return {
        poll: {
          question: copy.config.question,
          likeLabel: copy.config.likeLabel,
          commentLabel: copy.config.commentLabel,
          shareLabel: copy.config.shareLabel ?? undefined,
        },
      };
    case 'myth-fact':
      return {
        mythFact: {
          seriesTitle: copy.config.seriesTitle ?? undefined,
          pairs: copy.config.pairs,
          ctaText: copy.config.ctaText ?? undefined,
        },
      };
    case 'versus':
      return { versus: copy.config };
    case 'price-reveal':
      return {
        priceReveal: {
          hook: copy.config.hook,
          items: copy.config.items,
          totalPrice: copy.config.totalPrice,
          valueLine: copy.config.valueLine ?? undefined,
        },
      };
    case 'client-question':
      return {
        clientQuestion: {
          question: copy.config.question,
          asker: copy.config.asker,
          answers: copy.config.answers,
          ctaText: copy.config.ctaText ?? undefined,
        },
      };
    case 'come-with-me':
      return {
        comeWithMe: {
          title: copy.config.title,
          seriesChip: copy.config.seriesChip ?? undefined,
          steps: copy.config.steps,
          closingCta: copy.config.closingCta,
        },
      };
  }
}
