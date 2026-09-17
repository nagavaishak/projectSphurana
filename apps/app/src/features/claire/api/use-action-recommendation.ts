import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Mark a recommendation `actioned` (Accept clicked).
 * Caller is responsible for the side-effect — navigate, dispatch a tour, etc.
 * (See ClaireWalkthroughProvider.dispatch().)
 */
export const useActionRecommendation = (options?: {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (recommendationId: string) =>
      apiClient.post(`claire/recommendations/${recommendationId}/action`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['claire-recommendations'] });
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to action recommendation');
      options?.onError?.(error);
    },
  });

  return {
    actionRecommendation: mutation.mutate,
    actionRecommendationAsync: mutation.mutateAsync,
    isActioning: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
};
