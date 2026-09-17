import { invalidateKeys, queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface SetDefaultLeadFormInput {
  leadFormId: string;
  leadFormName?: string;
}

interface SetDefaultLeadFormResult {
  success: boolean;
  leadFormId: string;
  leadFormName: string | null;
}

interface UseSetDefaultLeadFormOptions {
  onSuccess?: (result: SetDefaultLeadFormResult) => void;
  onError?: (error: Error) => void;
}

export const useSetDefaultLeadForm = (
  options?: UseSetDefaultLeadFormOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: SetDefaultLeadFormInput) =>
      apiClient.put<SetDefaultLeadFormResult>(
        'integrations/meta-ads/default-lead-form',
        input
      ),
    onSuccess: (result) => {
      // `defaultLeadFormId` lives on the integration record. This used to
      // invalidate `['meta-integration']` — a root no query has — so the panel
      // kept showing the previous default.
      invalidateKeys(queryClient, queryKeys.integrations.metaAdsIntegration());
      toast.success('Default lead form saved');
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to set default lead form');
      options?.onError?.(error);
    },
  });

  return {
    setDefaultLeadForm: mutation.mutate,
    setDefaultLeadFormAsync: mutation.mutateAsync,
    isSetting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
