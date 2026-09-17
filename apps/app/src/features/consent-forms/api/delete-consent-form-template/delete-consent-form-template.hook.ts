import { invalidateKeys, queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/** Backend built in parallel — if the path moves, adjust it here only. */
const endpoint = (id: string) => `consent-form-templates/${id}`;

export const useDeleteConsentFormTemplate = (options?: {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(endpoint(id)),
    onSuccess: () => {
      invalidateKeys(queryClient, queryKeys.consentFormTemplates.all());
      toast.success('Template deleted');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete template');
      options?.onError?.(error);
    },
  });

  return {
    deleteTemplate: mutation.mutate,
    deleteTemplateAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
  };
};
