import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { LeadMembership } from '../types';

interface UseCancelLeadMembershipOptions {
  onSuccess?: (membership: LeadMembership) => void;
  onError?: (error: Error) => void;
}

export const useCancelLeadMembership = (
  options?: UseCancelLeadMembershipOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (membershipId: string) =>
      apiClient.post<LeadMembership>(
        `lead-memberships/${membershipId}/cancel`,
        {}
      ),
    onSuccess: async (membership) => {
      await queryClient.invalidateQueries({ queryKey: ['lead-memberships'] });
      toast.success('Membership cancelled');
      options?.onSuccess?.(membership);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to cancel membership');
      options?.onError?.(error);
    },
  });

  return {
    cancelLeadMembership: mutation.mutate,
    cancelLeadMembershipAsync: mutation.mutateAsync,
    isCancelling: mutation.isPending,
  };
};
