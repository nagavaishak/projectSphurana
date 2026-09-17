import { apiClient } from '@borradh-workspace/api-client';
import type { Notification } from '@borradh-workspace/api-client/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export const useMarkNotificationRead = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post<Notification>(`notifications/${id}/read`),
    onSuccess: () => {
      // Invalidates both the list and the unread-count query.
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: () => {
      toast.error('Failed to mark notification as read');
    },
  });

  return {
    markRead: mutation.mutate,
    markReadAsync: mutation.mutateAsync,
    isMarking: mutation.isPending,
  };
};
