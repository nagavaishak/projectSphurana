import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import type { MemoriesListResponse } from '../use-memories';

interface EditMemoryInput {
  id: string;
  content: string;
}

interface EditMemoryResponse {
  knowledgeEntryId: string;
  content: string;
  updatedAt: string;
}

interface UseEditMemoryOptions {
  onSuccess?: (memory: EditMemoryResponse) => void;
}

/**
 * Mutation hook for `PATCH /assistant/memories/:id`.
 *
 * On success: invalidates the memories list cache so the row refreshes
 * with the new content + updatedAt. Optimistic in-place update on
 * `onMutate` keeps the UI responsive; rolls back on error.
 *
 * Hard-block 400s come back with a human-readable message — the api-client
 * surfaces the server's text on the thrown error, so show it verbatim
 * (per W-C14-backend handoff note 2).
 */
export const useEditMemory = (options?: UseEditMemoryOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, content }: EditMemoryInput) =>
      apiClient.patch<EditMemoryResponse>(`assistant/memories/${id}`, {
        content,
      }),
    onMutate: async ({ id, content }) => {
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
          items: value.items.map((m) =>
            m.id === id
              ? { ...m, content, updatedAt: new Date().toISOString() }
              : m
          ),
        });
      }

      return { snapshots };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.snapshots) {
        for (const [key, value] of ctx.snapshots) {
          queryClient.setQueryData(key, value);
        }
      }
      const message =
        err instanceof Error ? err.message : 'Failed to update memory';
      toast.error(message);
    },
    onSuccess: (memory) => {
      toast.success('Memory updated');
      options?.onSuccess?.(memory);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['assistant', 'memories'] });
    },
  });

  return {
    editMemory: mutation.mutate,
    editMemoryAsync: mutation.mutateAsync,
    isEditing: mutation.isPending,
  };
};
