import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export interface InitiateMetaAdsFlfbInput {
  code: string;
}

export interface InitiateMetaAdsFlfbResponse {
  integrationId: string;
}

interface UseInitiateMetaAdsFlfbOptions {
  onSuccess?: (data: InitiateMetaAdsFlfbResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * Exchanges the Facebook Login for Business popup `code` server-side via
 * POST /integrations/meta-ads/initiate. The API exchanges it (redirect-less,
 * single call) for a non-expiring system-user token, saves a
 * pending_selection Meta Ads integration, and returns the integrationId for
 * the selection wizard.
 */
export const useInitiateMetaAdsFlfb = (
  options?: UseInitiateMetaAdsFlfbOptions
) => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: InitiateMetaAdsFlfbInput) =>
      apiClient.post<InitiateMetaAdsFlfbResponse>(
        'integrations/meta-ads/initiate',
        input
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['integrations', 'meta-ads'] });
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to start Meta connection');
      options?.onError?.(error);
    },
  });

  return {
    initiate: mutation.mutate,
    initiateAsync: mutation.mutateAsync,
    isInitiating: mutation.isPending,
  };
};
