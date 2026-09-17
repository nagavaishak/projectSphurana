import { apiClient } from '@borradh-workspace/api-client';
import type {
  NotificationPreferences,
  UpdateNotificationPreferencesInput,
} from '@borradh-workspace/api-client/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export const useUpdateNotificationPreferences = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: UpdateNotificationPreferencesInput) =>
      apiClient.put<NotificationPreferences>('notification-preferences', input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: ['notification-preferences'],
      });
      const previous = queryClient.getQueryData<NotificationPreferences>([
        'notification-preferences',
      ]);
      if (previous) {
        queryClient.setQueryData<NotificationPreferences>(
          ['notification-preferences'],
          { ...previous, ...input }
        );
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ['notification-preferences'],
          context.previous
        );
      }
      toast.error('Failed to update notification preferences');
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ['notification-preferences'],
      });
    },
  });

  return {
    update: mutation.mutate,
    updateAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
