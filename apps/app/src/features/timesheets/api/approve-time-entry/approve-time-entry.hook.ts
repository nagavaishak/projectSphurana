import { apiClient } from '@borradh-workspace/api-client';
import type { TimeEntry } from '@borradh-workspace/api-client/types';
import { timeEntrySchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseApproveTimeEntryOptions {
  onSuccess?: (timeEntry: TimeEntry) => void;
  onError?: (error: Error) => void;
}

export const useApproveTimeEntry = (options?: UseApproveTimeEntryOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post<TimeEntry>(`time-entries/${id}/approve`, undefined, {
        schema: timeEntrySchema,
      }),
    onSuccess: (timeEntry) => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      toast.success('Time entry approved');
      options?.onSuccess?.(timeEntry);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to approve time entry');
      options?.onError?.(error);
    },
  });

  return {
    approveTimeEntry: mutation.mutate,
    approveTimeEntryAsync: mutation.mutateAsync,
    isApproving: mutation.isPending,
  };
};
