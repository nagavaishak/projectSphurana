'use client';

import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CreateIntakeFormInput, IntakeForm } from '../types';

export const useCreateIntakeForm = (options?: {
  onSuccess?: (form: IntakeForm) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreateIntakeFormInput) =>
      apiClient.post<IntakeForm>('intake-forms', input),
    onSuccess: (form) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.intakeForms.all() });
      toast.success('Form created');
      options?.onSuccess?.(form);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create form');
      options?.onError?.(error);
    },
  });

  return {
    createForm: mutation.mutate,
    createFormAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
};
