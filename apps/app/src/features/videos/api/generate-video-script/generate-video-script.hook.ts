import { apiClient } from '@borradh-workspace/api-client';
import { useMutation } from '@tanstack/react-query';
import type { GenerateVideoScriptInput } from './generate-video-script.input';
import { buildGenerateVideoScriptPayload } from './generate-video-script.payload';

interface GenerateVideoScriptResponse {
  scriptText: string;
}

export const useGenerateVideoScript = (options?: {
  onSuccess?: (data: GenerateVideoScriptResponse) => void;
  onError?: (error: Error) => void;
}) => {
  const mutation = useMutation({
    // Surfaces pass the shared intent; the one builder assembles the body.
    mutationFn: async (input: GenerateVideoScriptInput) => {
      return apiClient.post<GenerateVideoScriptResponse>(
        'videos/generate-script',
        buildGenerateVideoScriptPayload(input)
      );
    },
    onSuccess: (data) => {
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      options?.onError?.(error);
    },
  });

  return {
    generateScript: mutation.mutate,
    generateScriptAsync: mutation.mutateAsync,
    isGenerating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
