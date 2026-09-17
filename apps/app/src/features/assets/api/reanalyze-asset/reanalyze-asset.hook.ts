import { logError } from '@/lib/log-error';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseReanalyzeAssetOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  showToast?: boolean;
}

interface ReanalyzeResponse {
  message: string;
  analysisId: string;
}

export const useReanalyzeAsset = (options?: UseReanalyzeAssetOptions) => {
  const queryClient = useQueryClient();
  const showToast = options?.showToast !== false;

  const mutation = useMutation({
    mutationFn: (assetId: string) =>
      apiClient.post<ReanalyzeResponse>(`assets/${assetId}/analyze`),
    onSuccess: (_, assetId) => {
      queryClient.invalidateQueries({
        queryKey: ['assets', assetId, 'analysis'],
      });
      queryClient.invalidateQueries({ queryKey: ['assets', assetId] });
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      logError('assets.reanalyze', error, { feature: 'assets' });
      if (showToast)
        toast.error(error.message || 'Failed to queue asset analysis');
      options?.onError?.(error);
    },
  });

  return {
    reanalyzeAsset: mutation.mutate,
    reanalyzeAssetAsync: mutation.mutateAsync,
    isReanalyzing: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
