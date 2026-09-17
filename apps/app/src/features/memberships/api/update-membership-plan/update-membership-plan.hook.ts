import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  MembershipPlanWithServices,
  UpdateMembershipPlanInput,
} from '../types';

interface UseUpdateMembershipPlanOptions {
  onSuccess?: (plan: MembershipPlanWithServices) => void;
  onError?: (error: Error) => void;
}

export const useUpdateMembershipPlan = (
  options?: UseUpdateMembershipPlanOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      planId,
      ...input
    }: UpdateMembershipPlanInput & { planId: string }) =>
      apiClient.put<MembershipPlanWithServices>(
        `membership-plans/${planId}`,
        input
      ),
    onSuccess: async (plan) => {
      await queryClient.invalidateQueries({ queryKey: ['membership-plans'] });
      toast.success('Membership plan updated');
      options?.onSuccess?.(plan);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update membership plan');
      options?.onError?.(error);
    },
  });

  return {
    updateMembershipPlan: mutation.mutate,
    updateMembershipPlanAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
