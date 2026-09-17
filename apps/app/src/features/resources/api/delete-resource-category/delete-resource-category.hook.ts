import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { type ResourceConflict, toResourceConflict } from '../conflict';

interface UseDeleteResourceCategoryOptions {
  onSuccess?: () => void;
  /**
   * 409 — the category still holds resources. The UI should offer
   * "Deactivate instead" (or send the user to move the resources out) rather
   * than showing a failure.
   */
  onConflict?: (conflict: ResourceConflict, id: string) => void;
  /** Any NON-409 failure. A 409 never reaches this. */
  onError?: (error: Error) => void;
}

/**
 * Delete a resource category.
 *
 * THE DELETE GUARD. The API answers **409 with the blocking count** when the
 * category still holds resources. That is not a failure — it is the API
 * telling the user their other option. So a 409 is routed to `onConflict` and
 * surfaced as `conflict` / `isConflict` state, and NO red toast fires; only a
 * genuine failure (500, network, permission) gets the generic toast.
 *
 * Note `deleteCategoryAsync` still REJECTS on 409, like any mutation — callers
 * using the async form must catch and check `isConflictError(err)`. The
 * callback/state form is the ergonomic one for the confirm dialog.
 */
export const useDeleteResourceCategory = (
  options?: UseDeleteResourceCategoryOptions
) => {
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState<ResourceConflict | null>(null);

  const mutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`resources/categories/${id}`),
    // Clear any previous conflict so a retry never renders a stale banner.
    onMutate: () => {
      setConflict(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.resources.all(),
      });
      toast.success('Category deleted');
      options?.onSuccess?.();
    },
    onError: (error: Error, id) => {
      const detected = toResourceConflict(
        error,
        'This category still has resources in it.'
      );
      if (detected) {
        setConflict(detected);
        options?.onConflict?.(detected, id);
        return;
      }
      toast.error(error.message || 'Failed to delete category');
      options?.onError?.(error);
    },
  });

  const clearConflict = useCallback(() => setConflict(null), []);

  return {
    deleteCategory: mutation.mutate,
    deleteCategoryAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
    /** The 409, when the category still holds resources. */
    conflict,
    isConflict: conflict !== null,
    /** Dismiss the conflict prompt (e.g. the user closed the dialog). */
    clearConflict,
    isSuccess: mutation.isSuccess,
  };
};
