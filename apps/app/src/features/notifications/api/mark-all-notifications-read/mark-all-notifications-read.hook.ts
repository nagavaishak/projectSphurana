import { apiClient } from '@borradh-workspace/api-client';
import type { MarkAllNotificationsReadResponse } from '@borradh-workspace/api-client/types';
import { markAllNotificationsReadResponseSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export const useMarkAllNotificationsRead = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post<MarkAllNotificationsReadResponse>(
        'notifications/read-all',
        undefined,
        { schema: markAllNotificationsReadResponseSchema }
      ),
    onSuccess: () => {
      // Invalidates both the list and the unread-count query.
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: () => {
      toast.error('Failed to mark all notifications as read');
    },
  });

  return {
    markAllRead: mutation.mutate,
    markAllReadAsync: mutation.mutateAsync,
    isMarking: mutation.isPending,
  };
};
