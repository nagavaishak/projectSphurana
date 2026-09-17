import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { PractitionerWageConfig, UpdateWageConfigInput } from '../types';

interface UpdateWageConfigVariables extends UpdateWageConfigInput {
  practitionerId: string;
}

interface UseUpdateWageConfigOptions {
  onSuccess?: (wageConfig: PractitionerWageConfig) => void;
  onError?: (error: Error) => void;
}

export const useUpdateWageConfig = (options?: UseUpdateWageConfigOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ practitionerId, ...input }: UpdateWageConfigVariables) =>
      apiClient.put<PractitionerWageConfig>(
        `wage-configs/${practitionerId}`,
        input
      ),
    onSuccess: (wageConfig) => {
      queryClient.invalidateQueries({
        queryKey: ['wage-config', wageConfig.practitionerId],
      });
      toast.success('Wage settings saved');
      options?.onSuccess?.(wageConfig);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save wage settings');
      options?.onError?.(error);
    },
  });

  return {
    updateWageConfig: mutation.mutate,
    updateWageConfigAsync: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
};
