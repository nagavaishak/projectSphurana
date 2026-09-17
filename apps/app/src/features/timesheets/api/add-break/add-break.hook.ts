import { apiClient } from '@borradh-workspace/api-client';
import type {
  AddBreakInput,
  TimeEntryWithBreaks,
} from '@borradh-workspace/api-client/types';
import { timeEntryWithBreaksSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseAddBreakOptions {
  onSuccess?: (timeEntry: TimeEntryWithBreaks) => void;
  onError?: (error: Error) => void;
}

/**
 * Toggles a break on an open time entry.
 * `type: 'start'` opens a new break, `type: 'end'` closes the running one.
 */
export const useAddBreak = (options?: UseAddBreakOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, ...input }: AddBreakInput & { id: string }) =>
      apiClient.post<TimeEntryWithBreaks>(`time-entries/${id}/breaks`, input, {
        schema: timeEntryWithBreaksSchema,
      }),
    onSuccess: (timeEntry, variables) => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      toast.success(
        variables.type === 'start' ? 'Break started' : 'Break ended'
      );
      options?.onSuccess?.(timeEntry);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update break');
      options?.onError?.(error);
    },
  });

  return {
    addBreak: mutation.mutate,
    addBreakAsync: mutation.mutateAsync,
    isAddingBreak: mutation.isPending,
  };
};
