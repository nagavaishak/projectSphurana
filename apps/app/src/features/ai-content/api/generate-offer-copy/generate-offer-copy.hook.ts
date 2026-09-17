import { apiClient } from '@borradh-workspace/api-client';
import {
  type GeneratedOfferCopy,
  generatedOfferCopySchema,
} from '@borradh-workspace/contracts';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  type GenerateOfferCopyInput,
  buildGenerateOfferCopyPayload,
} from './generate-offer-copy.payload';

export type { GeneratedOfferCopy };
export type { GenerateOfferCopyInput };

interface UseGenerateOfferCopyOptions {
  onSuccess?: (data: GeneratedOfferCopy) => void;
  onError?: (error: Error) => void;
}

/**
 * Window 9 — calls `POST /ai-content/generate-offer-copy`, which produces
 * the full video-copy bundle (headline + CTA + urgency + audience + bullets)
 * for a selected offer. The backend always returns SOMETHING — even on LLM
 * failure it falls back to templated copy — so the consumer can prefill the
 * video form unconditionally.
 */
export const useGenerateOfferCopy = (options?: UseGenerateOfferCopyOptions) => {
  const mutation = useMutation({
    // Surfaces pass the shared intent; the one builder assembles the body.
    mutationFn: (input: GenerateOfferCopyInput) =>
      apiClient.post<GeneratedOfferCopy>(
        'ai-content/generate-offer-copy',
        buildGenerateOfferCopyPayload(input),
        { schema: generatedOfferCopySchema }
      ),
    onSuccess: (data) => {
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to generate offer copy');
      options?.onError?.(error);
    },
  });

  return {
    generateOfferCopy: mutation.mutate,
    generateOfferCopyAsync: mutation.mutateAsync,
    isGenerating: mutation.isPending,
    generatedCopy: mutation.data ?? null,
    reset: mutation.reset,
  };
};
