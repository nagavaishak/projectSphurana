import { apiClient } from '@borradh-workspace/api-client';
import { syncConversationsResponseSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';

interface SyncResult {
  synced: number;
  errors: number;
}

export const useSyncConversations = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post<SyncResult>(
        'conversations/sync',
        {},
        {
          schema: syncConversationsResponseSchema,
        }
      ),
    onSuccess: (data) => {
      if (data.synced > 0) {
        // Invalidate all conversation and message queries so the UI refreshes
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
      }
    },
  });

  return {
    syncConversations: mutation.mutate,
    syncConversationsAsync: mutation.mutateAsync,
    isSyncing: mutation.isPending,
    syncResult: mutation.data ?? null,
  };
};
