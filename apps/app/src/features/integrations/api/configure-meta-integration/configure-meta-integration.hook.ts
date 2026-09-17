import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  ConfigureMetaIntegrationInput,
  ConfigureMetaIntegrationResponse,
} from '../../types';

interface UseConfigureMetaIntegrationOptions {
  onSuccess?: (data: ConfigureMetaIntegrationResponse) => void;
  onError?: (error: Error) => void;
}

export const useConfigureMetaIntegration = (
  options?: UseConfigureMetaIntegrationOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: ConfigureMetaIntegrationInput) =>
      apiClient.post<ConfigureMetaIntegrationResponse>(
        'integrations/meta-ads/configure',
        input
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ['integrations', 'meta-ads'],
      });
      toast.success('Meta Ads connected successfully');
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to configure Meta Ads');
      options?.onError?.(error);
    },
  });

  return {
    configureMeta: mutation.mutate,
    configureMetaAsync: mutation.mutateAsync,
    isConfiguring: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
