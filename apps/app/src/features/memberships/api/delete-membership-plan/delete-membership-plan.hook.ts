import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { DeleteMembershipPlanResponse } from '../types';

interface UseDeleteMembershipPlanOptions {
  onSuccess?: (result: DeleteMembershipPlanResponse) => void;
  onError?: (error: Error) => void;
}

export const useDeleteMembershipPlan = (
  options?: UseDeleteMembershipPlanOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (planId: string) =>
      apiClient.delete<DeleteMembershipPlanResponse>(
        `membership-plans/${planId}`
      ),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['membership-plans'] });
      toast.success(
        result.deactivated
          ? 'Plan has sold memberships, so it was deactivated instead of deleted'
          : 'Membership plan deleted'
      );
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete membership plan');
      options?.onError?.(error);
    },
  });

  return {
    deleteMembershipPlan: mutation.mutate,
    deleteMembershipPlanAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
  };
};
