import { apiClient } from '@borradh-workspace/api-client';
import type {
  ClockOutInput,
  TimeEntry,
} from '@borradh-workspace/api-client/types';
import { timeEntrySchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseClockOutOptions {
  onSuccess?: (timeEntry: TimeEntry) => void;
  onError?: (error: Error) => void;
}

export const useClockOut = (options?: UseClockOutOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, ...input }: ClockOutInput & { id: string }) =>
      apiClient.post<TimeEntry>(`time-entries/${id}/clock-out`, input, {
        schema: timeEntrySchema,
      }),
    onSuccess: (timeEntry) => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      toast.success('Clocked out');
      options?.onSuccess?.(timeEntry);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to clock out');
      options?.onError?.(error);
    },
  });

  return {
    clockOut: mutation.mutate,
    clockOutAsync: mutation.mutateAsync,
    isClockingOut: mutation.isPending,
  };
};
