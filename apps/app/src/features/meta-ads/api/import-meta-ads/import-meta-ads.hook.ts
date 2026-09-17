import { apiClient } from '@borradh-workspace/api-client';
import { importAdsResponseSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ImportAdsResponse } from '../types';

interface UseImportMetaAdsOptions {
  onSuccess?: (data: ImportAdsResponse) => void;
  onError?: (error: Error) => void;
}

export const useImportMetaAds = (options?: UseImportMetaAdsOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post<ImportAdsResponse>('meta-ads/import', undefined, {
        schema: importAdsResponseSchema,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['meta-ads'] });
      if (data.imported > 0) {
        toast.success(
          `Imported ${data.imported} ad${data.imported === 1 ? '' : 's'} from Meta`
        );
      } else {
        toast.info('No new ads to import');
      }
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to import ads from Meta');
      options?.onError?.(error);
    },
  });

  return {
    importAds: mutation.mutate,
    importAdsAsync: mutation.mutateAsync,
    isImporting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
