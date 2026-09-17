import { trackEvent } from '@/components/providers';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { MetaAdsIntegration } from '../../types';

export interface ConnectMetaIntegrationInput {
  code: string;
  adAccountId: string;
  adAccountName?: string;
  pageId: string;
  pageName?: string;
  pixelId?: string;
  pixelName?: string;
}

interface ConnectMetaIntegrationResponse {
  success: boolean;
  integration: MetaAdsIntegration;
}

interface UseConnectMetaIntegrationOptions {
  onSuccess?: (integration: MetaAdsIntegration) => void;
  onError?: (error: Error) => void;
}

export const useConnectMetaIntegration = (
  options?: UseConnectMetaIntegrationOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: ConnectMetaIntegrationInput) =>
      apiClient.post<ConnectMetaIntegrationResponse>(
        'integrations/meta-ads/connect',
        input
      ),
    onSuccess: (response) => {
      trackEvent('meta_integration_connected');
      // Invalidate meta integration queries
      queryClient.invalidateQueries({
        queryKey: ['integrations', 'meta-ads'],
      });
      toast.success('Meta Ads connected successfully');
      if (response.success) {
        options?.onSuccess?.(response.integration);
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to connect Meta Ads');
      options?.onError?.(error);
    },
  });

  return {
    connectMeta: mutation.mutate,
    connectMetaAsync: mutation.mutateAsync,
    isConnecting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
    reset: mutation.reset,
  };
};
