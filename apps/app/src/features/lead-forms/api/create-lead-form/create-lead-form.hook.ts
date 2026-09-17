import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CreateLeadFormInput, LeadForm } from '../types';

export const useCreateLeadForm = (options?: {
  onSuccess?: (leadForm: LeadForm) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: CreateLeadFormInput) => {
      return apiClient.post<LeadForm>('lead-forms', input);
    },
    onSuccess: (leadForm) => {
      queryClient.invalidateQueries({ queryKey: ['lead-forms'] });
      toast.success('Lead form created');
      options?.onSuccess?.(leadForm);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create lead form');
      options?.onError?.(error);
    },
  });

  return {
    createLeadForm: mutation.mutate,
    createLeadFormAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
