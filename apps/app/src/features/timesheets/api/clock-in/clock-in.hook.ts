import { apiClient } from '@borradh-workspace/api-client';
import type {
  ClockInInput,
  TimeEntry,
} from '@borradh-workspace/api-client/types';
import { timeEntrySchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseClockInOptions {
  onSuccess?: (timeEntry: TimeEntry) => void;
  onError?: (error: Error) => void;
}

export const useClockIn = (options?: UseClockInOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: ClockInInput) =>
      apiClient.post<TimeEntry>('time-entries/clock-in', input, {
        schema: timeEntrySchema,
      }),
    onSuccess: (timeEntry) => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      toast.success('Clocked in');
      options?.onSuccess?.(timeEntry);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to clock in');
      options?.onError?.(error);
    },
  });

  return {
    clockIn: mutation.mutate,
    clockInAsync: mutation.mutateAsync,
    isClockingIn: mutation.isPending,
  };
};
