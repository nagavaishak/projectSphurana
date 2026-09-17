import { apiClient } from '@borradh-workspace/api-client';
import { generatedContentSchema } from '@borradh-workspace/contracts';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { GenerateContentInput, GeneratedContent } from '../types';
import { buildGenerateContentPayload } from './generate-content.payload';

interface UseGenerateContentOptions {
  onSuccess?: (data: GeneratedContent) => void;
}

export const useGenerateContent = (options?: UseGenerateContentOptions) => {
  const mutation = useMutation({
    // Surfaces pass the shared intent; the one builder assembles the body.
    mutationFn: (input: GenerateContentInput) =>
      apiClient.post<GeneratedContent>(
        'ai-content/generate',
        buildGenerateContentPayload(input),
        {
          schema: generatedContentSchema,
        }
      ),
    onSuccess: (data) => {
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to generate content');
    },
  });

  return {
    generateContent: mutation.mutate,
    generateContentAsync: mutation.mutateAsync,
    isGenerating: mutation.isPending,
    generatedContent: mutation.data ?? null,
    reset: mutation.reset,
  };
};
