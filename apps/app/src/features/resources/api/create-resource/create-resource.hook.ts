import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CreateResourceInput, Resource } from '../types';

interface UseCreateResourceOptions {
  onSuccess?: (resource: Resource) => void;
  onError?: (error: Error) => void;
  /**
   * What the clinic calls the thing — "Room", "Equipment". The toast is the
   * confirmation for an action the operator just took by name; "Resource
   * created" is the schema's word for it, not theirs.
   */
  noun?: string;
}

export const useCreateResource = (options?: UseCreateResourceOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreateResourceInput) =>
      apiClient.post<Resource>('resources', input),
    // Async so `mutateAsync` waits for the refetch — the create dialog closes
    // on resolve and the list behind it must already show the new room.
    onSuccess: async (resource) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.resources.all(),
      });
      toast.success(`${options?.noun ?? 'Resource'} created`);
      options?.onSuccess?.(resource);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create resource');
      options?.onError?.(error);
    },
  });

  return {
    createResource: mutation.mutate,
    createResourceAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
