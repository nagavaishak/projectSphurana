'use client';

import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  SetServiceIntakeFormsInput,
  SetServiceIntakeFormsResponse,
} from '../types';

export const useSetServiceIntakeForms = (options?: {
  onSuccess?: (result: SetServiceIntakeFormsResponse) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      serviceId,
      ...input
    }: SetServiceIntakeFormsInput & { serviceId: string }) =>
      apiClient.put<SetServiceIntakeFormsResponse>(
        `intake-forms/services/${serviceId}/forms`,
        input
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.intakeForms.all() });
      toast.success('Forms linked to service');
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to link forms');
    },
  });

  return {
    setServiceForms: mutation.mutate,
    isSaving: mutation.isPending,
  };
};
