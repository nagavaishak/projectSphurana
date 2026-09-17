import { apiClient } from '@borradh-workspace/api-client';
import type {
  TimeEntry,
  UpdateTimeEntryInput,
} from '@borradh-workspace/api-client/types';
import { timeEntrySchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseUpdateTimeEntryOptions {
  onSuccess?: (timeEntry: TimeEntry) => void;
  onError?: (error: Error) => void;
}

export const useUpdateTimeEntry = (options?: UseUpdateTimeEntryOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, ...input }: UpdateTimeEntryInput & { id: string }) =>
      apiClient.put<TimeEntry>(`time-entries/${id}`, input, {
        schema: timeEntrySchema,
      }),
    onSuccess: (timeEntry) => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      toast.success('Time entry updated');
      options?.onSuccess?.(timeEntry);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update time entry');
      options?.onError?.(error);
    },
  });

  return {
    updateTimeEntry: mutation.mutate,
    updateTimeEntryAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
