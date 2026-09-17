import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { assistantApiUrl, assistantRequestInit } from '@/lib/assistant-request';

import type { MemoriesListResponse } from './use-memories';

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
 * Hard-block 400s come back with a human-readable message — show the
 * server's text verbatim (per W-C14-backend handoff note 2).
 */
export const useEditMemory = (options?: UseEditMemoryOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ id, content }: EditMemoryInput) => {
      const res = await fetch(
        assistantApiUrl(`memories/${id}`),
        assistantRequestInit({
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        })
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          (data && typeof data === 'object' && 'message' in data
            ? (data as { message?: string }).message
            : null) ??
          (data && typeof data === 'object' && 'error' in data
            ? (data as { error?: string }).error
            : null) ??
          'Failed to update memory';
        throw new Error(message);
      }
      return data as EditMemoryResponse;
    },
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
