import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ReorderResourcesInput, Resource } from '../types';

interface UseReorderResourcesOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Reorder resources within their category (drag-to-sort in settings).
 *
 * OPTIMISTIC, because a reorder that waits on the network reads as a bug: the
 * row springs back under the cursor and then jumps to its new home a moment
 * later. So the cached list is resorted immediately and the server call is
 * treated as confirmation.
 *
 * WHY `setQueriesData` AND NOT `setQueryData`
 * -------------------------------------------
 * The list key carries its params — `['resources','list',{categoryId,…}]` —
 * so the settings page, the calendar column picker and the service form each
 * hold a DIFFERENT cache entry for the same underlying rows. Patching one by
 * exact key leaves the others showing the old order until they refetch. The
 * prefix match patches, and the snapshot restores, all of them.
 */
export const useReorderResources = (options?: UseReorderResourcesOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: ReorderResourcesInput) =>
      apiClient.put('resources/reorder', input),

    onMutate: async ({ items }: ReorderResourcesInput) => {
      // Stop any in-flight list fetch from landing on top of the optimistic
      // order and undoing it.
      await queryClient.cancelQueries({
        queryKey: queryKeys.resources.allLists(),
      });

      const previous = queryClient.getQueriesData<Resource[]>({
        queryKey: queryKeys.resources.allLists(),
      });

      const nextOrder = new Map(items.map((item) => [item.id, item.sortOrder]));

      queryClient.setQueriesData<Resource[]>(
        { queryKey: queryKeys.resources.allLists() },
        (old) => {
          if (!old) return old;
          return old
            .map((resource) => {
              const sortOrder = nextOrder.get(resource.id);
              return sortOrder === undefined
                ? resource
                : { ...resource, sortOrder };
            })
            .sort(
              (a, b) =>
                a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
            );
        }
      );

      return { previous };
    },

    // Roll every patched cache entry back to its snapshot, so the rows snap
    // to the order the server still believes in.
    onError: (error: Error, _variables, context) => {
      for (const [queryKey, data] of context?.previous ?? []) {
        queryClient.setQueryData(queryKey, data);
      }
      toast.error(error.message || 'Failed to reorder resources');
      options?.onError?.(error);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.resources.all() });
    },

    // No success toast: the rows have already moved, which IS the feedback.
    onSuccess: () => {
      options?.onSuccess?.();
    },
  });

  return {
    reorderResources: mutation.mutate,
    reorderResourcesAsync: mutation.mutateAsync,
    isReordering: mutation.isPending,
  };
};
