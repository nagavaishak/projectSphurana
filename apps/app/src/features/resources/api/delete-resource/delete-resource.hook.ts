import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { type ResourceConflict, toResourceConflict } from '../conflict';

interface UseDeleteResourceOptions {
  onSuccess?: () => void;
  /**
   * 409 — the resource has upcoming bookings. `conflict.count` is how many,
   * and `conflict.message` is the API's own copy:
   *
   *   "Room 2 has 4 upcoming bookings. Deactivate it instead, or move those
   *    bookings first."
   *
   * Render that and offer "Deactivate instead" (`useUpdateResource` with
   * `{ isActive: false }`).
   */
  onConflict?: (conflict: ResourceConflict, id: string) => void;
  /** Any NON-409 failure. A 409 never reaches this. */
  onError?: (error: Error) => void;
}

/**
 * Delete a resource.
 *
 * THE DELETE GUARD. A room with upcoming bookings cannot be deleted — the API
 * answers 409 with the count. Swallowing that into a generic red
 * "Failed to delete resource" toast would strand the user: the message they
 * need ("deactivate it instead") is IN the 409 and nowhere else. So the 409 is
 * routed to `onConflict` and exposed as `conflict` / `isConflict` state, with
 * no error toast; only a genuine failure gets the generic toast.
 *
 * `deleteResourceAsync` still rejects on 409 — callers using the async form
 * must catch and check `isConflictError(err)`.
 */
export const useDeleteResource = (options?: UseDeleteResourceOptions) => {
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState<ResourceConflict | null>(null);

  const mutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`resources/${id}`),
    // Clear any previous conflict so a retry never renders a stale banner.
    onMutate: () => {
      setConflict(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.resources.all(),
      });
      toast.success('Resource deleted');
      options?.onSuccess?.();
    },
    onError: (error: Error, id) => {
      const detected = toResourceConflict(
        error,
        'This resource has upcoming bookings. Deactivate it instead, or move those bookings first.'
      );
      if (detected) {
        setConflict(detected);
        options?.onConflict?.(detected, id);
        return;
      }
      toast.error(error.message || 'Failed to delete resource');
      options?.onError?.(error);
    },
  });

  const clearConflict = useCallback(() => setConflict(null), []);

  return {
    deleteResource: mutation.mutate,
    deleteResourceAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
    /** The 409, when the resource still has upcoming bookings. */
    conflict,
    isConflict: conflict !== null,
    /** How many upcoming bookings are blocking, when the API said. */
    conflictCount: conflict?.count,
    /** Dismiss the conflict prompt (e.g. the user closed the dialog). */
    clearConflict,
    isSuccess: mutation.isSuccess,
  };
};
