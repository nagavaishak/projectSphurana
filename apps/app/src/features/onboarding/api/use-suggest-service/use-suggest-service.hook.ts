import { apiClient } from '@borradh-workspace/api-client';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SuggestCampaignServiceResponse } from '../../types';

interface UseSuggestServiceOptions {
  onSuccess?: (suggestion: SuggestCampaignServiceResponse) => void;
  onError?: (error: Error) => void;
}

/** Pick the service the first campaign should advertise ("X because Y and Z"). */
export const useSuggestService = (options?: UseSuggestServiceOptions) => {
  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post<SuggestCampaignServiceResponse>(
        'onboarding/suggest-service'
      ),
    onSuccess: (suggestion) => {
      options?.onSuccess?.(suggestion);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to suggest a service');
      options?.onError?.(error);
    },
  });

  return {
    suggestService: mutation.mutate,
    suggestServiceAsync: mutation.mutateAsync,
    suggestion: mutation.data ?? null,
    isSuggesting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    reset: mutation.reset,
  };
};
