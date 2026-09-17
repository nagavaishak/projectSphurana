'use client';

import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { IntakeForm, UpdateIntakeFormInput } from '../types';

export const useUpdateIntakeForm = (options?: {
  onSuccess?: (form: IntakeForm) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, ...input }: UpdateIntakeFormInput & { id: string }) =>
      apiClient.put<IntakeForm>(`intake-forms/${id}`, input),
    onSuccess: (form) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.intakeForms.all() });
      queryClient.invalidateQueries({
        queryKey: queryKeys.intakeForms.detail(form.id),
      });
      toast.success('Form saved');
      options?.onSuccess?.(form);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save form');
    },
  });

  return {
    updateForm: mutation.mutate,
    updateFormAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
