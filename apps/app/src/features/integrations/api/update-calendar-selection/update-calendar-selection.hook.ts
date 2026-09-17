import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UpdateCalendarSelectionOptions {
  onSuccess?: () => void;
  /** Suppress toast messages (useful during onboarding) */
  silent?: boolean;
}

export const useUpdateCalendarSelection = (
  options?: UpdateCalendarSelectionOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      accountId,
      calendarId,
    }: {
      accountId: string;
      calendarId: string;
    }) =>
      apiClient.put<{ id: string; calendarId: string }>(
        `integrations/calendar/accounts/${accountId}`,
        { calendarId }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['integrations', 'calendar', 'accounts'],
      });
      if (!options?.silent) {
        toast.success('Calendar updated');
      }
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      if (!options?.silent) {
        toast.error(error.message || 'Failed to update calendar');
      }
    },
  });

  return {
    updateSelection: mutation.mutate,
    updateSelectionAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
