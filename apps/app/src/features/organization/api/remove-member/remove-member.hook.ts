import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Remove member response type
 */
export interface RemoveMemberResponse {
  success: boolean;
  removedUserId: string;
  organizationId: string;
}

/**
 * Remove Member Hook
 * Removes a member from an organization via NestJS API
 *
 * @param organizationId - The organization ID
 * @param options.onSuccess - Custom success callback
 * @param options.onError - Custom error callback
 */
export const useRemoveMember = (
  organizationId: string,
  options?: {
    onSuccess?: (data: RemoveMemberResponse) => void;
    onError?: (error: Error) => void;
  }
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (userId: string) => {
      return apiClient.delete<RemoveMemberResponse>(
        `organizations/${organizationId}/members/${userId}`
      );
    },
    onSuccess: (data) => {
      // Invalidate members query
      queryClient.invalidateQueries({
        queryKey: ['organization', organizationId, 'members'],
      });

      toast.success('Member removed successfully');

      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to remove member');
      options?.onError?.(error);
    },
  });

  return {
    ...mutation,
    execute: mutation.mutate,
    executeAsync: mutation.mutateAsync,
    isExecuting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
