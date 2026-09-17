import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CreateMembershipPlanInput,
  MembershipPlanWithServices,
} from '../types';

interface UseCreateMembershipPlanOptions {
  onSuccess?: (plan: MembershipPlanWithServices) => void;
  onError?: (error: Error) => void;
}

export const useCreateMembershipPlan = (
  options?: UseCreateMembershipPlanOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreateMembershipPlanInput) =>
      apiClient.post<MembershipPlanWithServices>('membership-plans', input),
    onSuccess: async (plan) => {
      await queryClient.invalidateQueries({ queryKey: ['membership-plans'] });
      toast.success('Membership plan created');
      options?.onSuccess?.(plan);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create membership plan');
      options?.onError?.(error);
    },
  });

  return {
    createMembershipPlan: mutation.mutate,
    createMembershipPlanAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
