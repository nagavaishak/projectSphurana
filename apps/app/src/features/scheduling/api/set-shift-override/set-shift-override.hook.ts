import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SetShiftOverrideInput, Shift } from '../types';

interface SetShiftOverrideVariables extends SetShiftOverrideInput {
  practitionerId: string;
}

interface UseSetShiftOverrideOptions {
  onSuccess?: (shifts: Shift[]) => void;
  onError?: (error: Error) => void;
}

export const useSetShiftOverride = (options?: UseSetShiftOverrideOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ practitionerId, ...input }: SetShiftOverrideVariables) =>
      apiClient.put<Shift[]>(`shifts/override/${practitionerId}`, input),
    onSuccess: (shifts) => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast.success('Shift updated');
      options?.onSuccess?.(shifts);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update shift');
      options?.onError?.(error);
    },
  });

  return {
    setShiftOverride: mutation.mutate,
    setShiftOverrideAsync: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
};
