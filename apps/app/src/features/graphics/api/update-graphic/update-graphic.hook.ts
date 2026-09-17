import { apiClient } from '@borradh-workspace/api-client';
import { graphicSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Graphic, UpdateGraphicInput } from '../types';

/**
 * Update Graphic Hook
 * Updates an existing graphic
 */
export const useUpdateGraphic = (options?: {
  onSuccess?: (graphic: Graphic) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({
      id,
      ...input
    }: UpdateGraphicInput & { id: string }) => {
      return apiClient.put<Graphic>(`graphics/${id}`, input, {
        schema: graphicSchema,
      });
    },
    onSuccess: (graphic) => {
      queryClient.invalidateQueries({ queryKey: ['graphics'] });
      queryClient.invalidateQueries({ queryKey: ['graphics', graphic.id] });
      toast.success('Graphic updated successfully');
      options?.onSuccess?.(graphic);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update graphic');
      options?.onError?.(error);
    },
  });

  return {
    updateGraphic: mutation.mutate,
    updateGraphicAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
