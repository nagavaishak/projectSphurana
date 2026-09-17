import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { LeadForm, SyncLeadFormInput } from '../types';

export const useSyncLeadForm = (options?: {
  onSuccess?: (leadForm: LeadForm) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({
      id,
      ...input
    }: SyncLeadFormInput & { id: string }) => {
      return apiClient.post<LeadForm>(`lead-forms/${id}/sync`, input);
    },
    onSuccess: (leadForm) => {
      queryClient.invalidateQueries({ queryKey: ['lead-forms'] });
      queryClient.invalidateQueries({ queryKey: ['lead-forms', leadForm.id] });
      toast.success('Lead form synced to Meta');
      options?.onSuccess?.(leadForm);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to sync lead form to Meta');
      options?.onError?.(error);
    },
  });

  return {
    syncLeadForm: mutation.mutate,
    syncLeadFormAsync: mutation.mutateAsync,
    isSyncing: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
