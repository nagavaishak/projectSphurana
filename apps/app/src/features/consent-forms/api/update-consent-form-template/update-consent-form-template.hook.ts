import { invalidateKeys, queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import type {
  ConsentFormTemplate,
  UpdateConsentFormTemplateInput,
} from '../types';

/** Backend built in parallel — if the path moves, adjust it here only. */
const endpoint = (id: string) => `consent-form-templates/${id}`;

export const useUpdateConsentFormTemplate = (options?: {
  onSuccess?: (template: ConsentFormTemplate) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      id,
      ...input
    }: UpdateConsentFormTemplateInput & { id: string }) =>
      apiClient.put<ConsentFormTemplate>(endpoint(id), input),
    onSuccess: (template) => {
      invalidateKeys(queryClient, queryKeys.consentFormTemplates.all());
      toast.success('Template updated');
      options?.onSuccess?.(template);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update template');
      options?.onError?.(error);
    },
  });

  return {
    updateTemplate: mutation.mutate,
    updateTemplateAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
};
