import { apiClient } from '@borradh-workspace/api-client';
import type { LeadMembership } from '@borradh-workspace/api-client/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Thin mutation hook: cancel a client's membership.
 *
 * Defined locally under `features/clients/api` so this workstream stays
 * disjoint from the memberships agent. Hits the live
 * `POST /lead-memberships/:id/cancel` endpoint.
 */
export const useCancelMembership = (options?: {
  leadId?: string;
  onSuccess?: (membership: LeadMembership) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (leadMembershipId: string) =>
      apiClient.post<LeadMembership>(
        `lead-memberships/${leadMembershipId}/cancel`,
        {}
      ),
    onSuccess: (membership) => {
      if (options?.leadId) {
        queryClient.invalidateQueries({
          queryKey: ['clients', options.leadId, 'memberships'],
        });
      }
      toast.success('Membership cancelled');
      options?.onSuccess?.(membership);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to cancel membership');
      options?.onError?.(error);
    },
  });

  return {
    cancelMembership: mutation.mutate,
    isCancelling: mutation.isPending,
  };
};
