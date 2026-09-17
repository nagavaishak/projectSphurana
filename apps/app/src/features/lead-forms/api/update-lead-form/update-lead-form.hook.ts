import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { LeadForm, UpdateLeadFormInput } from '../types';

export const useUpdateLeadForm = (options?: {
  onSuccess?: (leadForm: LeadForm) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({
      id,
      ...input
    }: UpdateLeadFormInput & { id: string }) => {
      return apiClient.put<LeadForm>(`lead-forms/${id}`, input);
    },
    onSuccess: (leadForm) => {
      queryClient.invalidateQueries({ queryKey: ['lead-forms'] });
      queryClient.invalidateQueries({ queryKey: ['lead-forms', leadForm.id] });
      toast.success('Lead form updated');
      options?.onSuccess?.(leadForm);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update lead form');
      options?.onError?.(error);
    },
  });

  return {
    updateLeadForm: mutation.mutate,
    updateLeadFormAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
