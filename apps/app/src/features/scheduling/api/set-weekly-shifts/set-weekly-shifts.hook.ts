import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SetWeeklyShiftsInput, Shift } from '../types';

interface SetWeeklyShiftsVariables extends SetWeeklyShiftsInput {
  practitionerId: string;
}

interface UseSetWeeklyShiftsOptions {
  onSuccess?: (shifts: Shift[]) => void;
  onError?: (error: Error) => void;
}

export const useSetWeeklyShifts = (options?: UseSetWeeklyShiftsOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ practitionerId, ...input }: SetWeeklyShiftsVariables) =>
      apiClient.put<Shift[]>(`shifts/weekly/${practitionerId}`, input),
    onSuccess: (shifts) => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast.success('Weekly schedule saved');
      options?.onSuccess?.(shifts);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save weekly schedule');
      options?.onError?.(error);
    },
  });

  return {
    setWeeklyShifts: mutation.mutate,
    setWeeklyShiftsAsync: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
};
