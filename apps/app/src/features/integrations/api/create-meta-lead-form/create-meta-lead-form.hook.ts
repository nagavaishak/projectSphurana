import { invalidateKeys, queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface CreateMetaLeadFormQuestion {
  type: string;
  label?: string;
  key?: string;
  options?: Array<{ value: string; key?: string }>;
}

interface CreateMetaLeadFormInput {
  name: string;
  questions: CreateMetaLeadFormQuestion[];
  /** Optional — the server falls back to the org website / Facebook Page. */
  privacyPolicyUrl?: string;
  thankYouPage?: {
    title?: string;
    body?: string;
    buttonText?: string;
    buttonUrl?: string;
  };
}

interface CreateMetaLeadFormResult {
  formId: string;
  name: string;
}

interface UseCreateMetaLeadFormOptions {
  onSuccess?: (result: CreateMetaLeadFormResult) => void;
  onError?: (error: Error) => void;
}

export const useCreateMetaLeadForm = (
  options?: UseCreateMetaLeadFormOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreateMetaLeadFormInput) =>
      apiClient.post<CreateMetaLeadFormResult>(
        'integrations/meta-ads/lead-forms',
        input
      ),
    onSuccess: (result) => {
      // The real keys are `['integrations','meta-ads',…]`. These used to be
      // `['meta-lead-forms']` / `['meta-integration']` — roots no query has —
      // so the lead-form picker went on showing a stale list.
      invalidateKeys(
        queryClient,
        queryKeys.integrations.metaAdsLeadForms(),
        queryKeys.integrations.metaAdsIntegration()
      );
      toast.success('Lead form created on Meta');
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create lead form on Meta');
      options?.onError?.(error);
    },
  });

  return {
    createMetaLeadForm: mutation.mutate,
    createMetaLeadFormAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
