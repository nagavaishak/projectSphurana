import { apiClient } from '@borradh-workspace/api-client';
import { useMutation } from '@tanstack/react-query';
import type {
  GenerateOrganicCopyInput,
  OrganicVariationId,
} from './generate-organic-copy.input';
import { buildGenerateOrganicCopyPayload } from './generate-organic-copy.payload';

export type { GenerateOrganicCopyInput, OrganicVariationId };

/**
 * Per-variation copy shapes. These mirror the matching draft-config blocks
 * (`VideoDraftConfig.captionTease` etc.) so the response can be piped
 * straight in without remapping.
 */
export interface CaptionTeaseCopy {
  headline: string;
  emphasis?: string;
  emoji?: string;
  caption: string;
}

export interface FadeBenefitsCopy {
  lines: string[];
}

export interface AestheticLineCopy {
  text: string;
}

export interface NumberedListCopy {
  title: string;
  items: string[];
}

export interface InsOutsCopy {
  title: string;
  insLabel?: string;
  insItems: string[];
  outsLabel?: string;
  outsItems: string[];
}

export interface QuestionCtaCopy {
  question: string;
  ctaText: string;
}

export interface ImprovesCopy {
  serviceName: string;
  items: string[];
  ctaText: string;
}

export interface StepTimerCopy {
  title: string;
  steps: Array<{ label: string; duration: string }>;
}

export interface TimeProgressCopy {
  startLabel: string;
  endLabel: string;
  caption: string;
}

export interface PollCopy {
  question: string;
  likeLabel: string;
  commentLabel: string;
  shareLabel?: string;
}

export interface MythFactCopy {
  seriesTitle?: string;
  pairs: Array<{ myth: string; fact: string }>;
  ctaText?: string;
}

export interface VersusCopy {
  treatmentA: string;
  treatmentB: string;
  rounds: Array<{ label: string; aValue: string; bValue: string }>;
  verdict: string;
}

export interface PriceRevealCopy {
  hook: string;
  items: Array<{ name: string; price: string }>;
  totalPrice: string;
  valueLine?: string;
}

export interface ClientQuestionCopy {
  question: string;
  asker: string;
  answers: string[];
  ctaText?: string;
}

export interface ComeWithMeCopy {
  title: string;
  seriesChip?: string;
  steps: string[];
  closingCta: string;
}

export type GeneratedOrganicCopy =
  | { kind: 'caption-tease'; config: CaptionTeaseCopy }
  | { kind: 'fade-benefits'; config: FadeBenefitsCopy }
  // Highlight Caption reuses the fade-benefits copy shape (a list of lines).
  | { kind: 'highlight-caption'; config: FadeBenefitsCopy }
  | { kind: 'aesthetic-line'; config: AestheticLineCopy }
  | { kind: 'numbered-list'; config: NumberedListCopy }
  | { kind: 'ins-outs'; config: InsOutsCopy }
  | { kind: 'question-cta'; config: QuestionCtaCopy }
  // Curiosity Hook reuses the question-cta copy shape (claim + CTA).
  | { kind: 'curiosity-hook'; config: QuestionCtaCopy }
  | { kind: 'improves'; config: ImprovesCopy }
  | { kind: 'step-timer'; config: StepTimerCopy }
  | { kind: 'time-progress'; config: TimeProgressCopy }
  | { kind: 'poll'; config: PollCopy }
  | { kind: 'myth-fact'; config: MythFactCopy }
  | { kind: 'versus'; config: VersusCopy }
  | { kind: 'price-reveal'; config: PriceRevealCopy }
  | { kind: 'client-question'; config: ClientQuestionCopy }
  | { kind: 'come-with-me'; config: ComeWithMeCopy };

export const useGenerateOrganicCopy = (options?: {
  onSuccess?: (data: GeneratedOrganicCopy) => void;
  onError?: (error: Error) => void;
}) => {
  const mutation = useMutation({
    // Surfaces pass the shared intent; the one builder assembles the body.
    mutationFn: async (input: GenerateOrganicCopyInput) =>
      apiClient.post<GeneratedOrganicCopy>(
        'videos/generate-organic-copy',
        buildGenerateOrganicCopyPayload(input)
      ),
    onSuccess: (data) => options?.onSuccess?.(data),
    onError: (error: Error) => options?.onError?.(error),
  });

  return {
    generateCopy: mutation.mutate,
    generateCopyAsync: mutation.mutateAsync,
    isGenerating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
