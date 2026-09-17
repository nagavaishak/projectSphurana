import { apiClient } from '@borradh-workspace/api-client';
import {
  type GeneratedOfferContent,
  generatedOfferContentSchema,
} from '@borradh-workspace/contracts';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  type GenerateOfferContentInput,
  buildGenerateOfferContentPayload,
} from './generate-offer-content.payload';

export type { GenerateOfferContentInput };

interface UseGenerateOfferContentOptions {
  onSuccess?: (data: GeneratedOfferContent) => void;
}

export const useGenerateOfferContent = (
  options?: UseGenerateOfferContentOptions
) => {
  const mutation = useMutation({
    // Surfaces pass the shared intent; the one builder assembles the body.
    mutationFn: (input: GenerateOfferContentInput) =>
      apiClient.post<GeneratedOfferContent>(
        'ai-content/generate-offer-content',
        buildGenerateOfferContentPayload(input),
        { schema: generatedOfferContentSchema }
      ),
    onSuccess: (data) => {
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to generate offer content');
    },
  });

  return {
    generateOfferContent: mutation.mutate,
    generateOfferContentAsync: mutation.mutateAsync,
    isGenerating: mutation.isPending,
    generatedContent: mutation.data ?? null,
    reset: mutation.reset,
  };
};
