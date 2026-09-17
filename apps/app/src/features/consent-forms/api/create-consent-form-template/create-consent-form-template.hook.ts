import { invalidateKeys, queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import type {
  ConsentFormTemplate,
  CreateConsentFormTemplateInput,
} from '../types';

/** Backend built in parallel — if the path moves, adjust it here only. */
const ENDPOINT = 'consent-form-templates';

export const useCreateConsentFormTemplate = (options?: {
  onSuccess?: (template: ConsentFormTemplate) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreateConsentFormTemplateInput) =>
      apiClient.post<ConsentFormTemplate>(ENDPOINT, input),
    onSuccess: (template) => {
      invalidateKeys(queryClient, queryKeys.consentFormTemplates.all());
      toast.success('Template created');
      options?.onSuccess?.(template);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create template');
      options?.onError?.(error);
    },
  });

  return {
    createTemplate: mutation.mutate,
    createTemplateAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
};
