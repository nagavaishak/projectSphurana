import { apiClient } from '@borradh-workspace/api-client';
import type {
  OrgDefaultsResponse,
  UpdateOrgDefaultsInput,
} from '@borradh-workspace/api-client/types';
import { orgDefaultsResponseSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Mutation hook for `PATCH /org-defaults`. Returns the next resolved
 * defaults so the cache can be primed without a follow-up GET. Surfaces a
 * toast on success/error per the project's hook convention.
 */
export const useUpdateOrgDefaults = (options?: {
  onSuccess?: (next: OrgDefaultsResponse) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: UpdateOrgDefaultsInput) =>
      apiClient.patch<OrgDefaultsResponse>('org-defaults', input, {
        schema: orgDefaultsResponseSchema,
      }),
    onSuccess: (next) => {
      // Prime the cache with the response so the form re-renders against
      // the new values immediately, then invalidate so any other consumers
      // (e.g. the "make this my default" affordance reading defaults) pull
      // fresh data on their next render.
      queryClient.setQueryData(['org-defaults'], next);
      queryClient.invalidateQueries({ queryKey: ['org-defaults'] });
      toast.success('Defaults saved');
      options?.onSuccess?.(next);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save defaults');
      options?.onError?.(error);
    },
  });

  return {
    updateDefaults: mutation.mutate,
    updateDefaultsAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
