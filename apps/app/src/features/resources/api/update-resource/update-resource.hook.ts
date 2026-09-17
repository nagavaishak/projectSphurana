import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Resource, UpdateResourceInput } from '../types';

/** `id` is a per-call field so one hook instance can update any resource. */
export type UpdateResourceVariables = UpdateResourceInput & { id: string };

interface UseUpdateResourceOptions {
  onSuccess?: (resource: Resource) => void;
  onError?: (error: Error) => void;
}

/**
 * Update a resource. Also the DEACTIVATE path — pass `{ isActive: false }`,
 * which is what the delete-guard conflict prompts the user to do instead of
 * deleting a room that still has bookings.
 */
export const useUpdateResource = (options?: UseUpdateResourceOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, ...input }: UpdateResourceVariables) =>
      apiClient.put<Resource>(`resources/${id}`, input),
    onSuccess: async (resource) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.resources.all(),
      });
      toast.success('Resource updated');
      options?.onSuccess?.(resource);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update resource');
      options?.onError?.(error);
    },
  });

  return {
    updateResource: mutation.mutate,
    updateResourceAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
