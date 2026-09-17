import { apiClient } from '@borradh-workspace/api-client';
import { graphicSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Graphic } from '../types';

/**
 * Delete Graphic Hook
 * Deletes a graphic by ID
 */
export const useDeleteGraphic = (options?: {
  onSuccess?: (graphic: Graphic) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (id: string) => {
      return apiClient.delete<Graphic>(`graphics/${id}`, {
        schema: graphicSchema,
      });
    },
    onSuccess: (graphic) => {
      queryClient.invalidateQueries({ queryKey: ['graphics'] });
      toast.success('Graphic deleted successfully');
      options?.onSuccess?.(graphic);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete graphic');
      options?.onError?.(error);
    },
  });

  return {
    deleteGraphic: mutation.mutate,
    deleteGraphicAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
