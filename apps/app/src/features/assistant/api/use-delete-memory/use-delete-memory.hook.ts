import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import type { MemoriesListResponse } from '../use-memories';

interface UseDeleteMemoryOptions {
  onSuccess?: (id: string) => void;
}

/**
 * Mutation hook for `DELETE /assistant/memories/:id`.
 *
 * Optimistic remove from any cached list query; rolls back on error.
 * Always invalidates `['assistant', 'memories']` on settle so paginated
 * tails can reload if the backend's total count changed.
 */
export const useDeleteMemory = (options?: UseDeleteMemoryOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`assistant/memories/${id}`);
      return { id };
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({
        queryKey: ['assistant', 'memories'],
      });

      const snapshots = queryClient.getQueriesData<MemoriesListResponse>({
        queryKey: ['assistant', 'memories'],
      });

      for (const [key, value] of snapshots) {
        if (!value) continue;
        queryClient.setQueryData<MemoriesListResponse>(key, {
          ...value,
          items: value.items.filter((m) => m.id !== id),
          total: Math.max(0, value.total - 1),
        });
      }

      return { snapshots };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.snapshots) {
        for (const [key, value] of ctx.snapshots) {
          queryClient.setQueryData(key, value);
        }
      }
      const message =
        err instanceof Error ? err.message : 'Failed to delete memory';
      toast.error(message);
    },
    onSuccess: ({ id }) => {
      toast.success('Memory deleted');
      options?.onSuccess?.(id);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['assistant', 'memories'] });
    },
  });

  return {
    deleteMemory: mutation.mutate,
    deleteMemoryAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
  };
};
