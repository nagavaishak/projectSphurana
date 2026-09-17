import { apiClient } from '@borradh-workspace/api-client';
import type { Graphic } from '@borradh-workspace/api-client/types';
import { graphicSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { GenerateGraphicInput } from './generate-graphic.input';
import { buildGenerateGraphicPayload } from './generate-graphic.payload';

export type { GenerateGraphicInput };

/**
 * Generate Graphic Hook
 *
 * POSTs to `/graphics/generate` to kick off the one-shot AI generation
 * flow. The API inserts a placeholder `graphic` row with status='rendering'
 * and enqueues a `graphic-generate` job (mode='plan-and-render'). The
 * frontend polls `GET /graphics/:id` (via GraphicProcessingModal) until
 * the row flips to `ready` or `failed`.
 */
export const useGenerateGraphic = (options?: {
  onSuccess?: (graphic: Graphic) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    // Surfaces pass the shared intent; the one builder assembles the body.
    mutationFn: (input: GenerateGraphicInput) =>
      apiClient.post<Graphic>(
        'graphics/generate',
        buildGenerateGraphicPayload(input),
        {
          schema: graphicSchema,
        }
      ),
    onSuccess: (graphic) => {
      queryClient.invalidateQueries({ queryKey: ['graphics'] });
      options?.onSuccess?.(graphic);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to generate graphic');
      options?.onError?.(error);
    },
  });

  return {
    generateGraphic: mutation.mutate,
    generateGraphicAsync: mutation.mutateAsync,
    isGenerating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
