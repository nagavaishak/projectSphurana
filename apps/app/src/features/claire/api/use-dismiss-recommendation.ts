import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Dismiss a recommendation row.
 * Marks `state = 'dismissed'` server-side; the trigger layer is free to
 * re-fire if the underlying situation persists (no permanent suppression).
 */
export const useDismissRecommendation = (options?: {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (recommendationId: string) =>
      apiClient.post(`claire/recommendations/${recommendationId}/dismiss`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['claire-recommendations'] });
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to dismiss');
      options?.onError?.(error);
    },
  });

  return {
    dismissRecommendation: mutation.mutate,
    dismissRecommendationAsync: mutation.mutateAsync,
    isDismissing: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
};
