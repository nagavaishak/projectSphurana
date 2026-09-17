import { trackEvent } from '@/components/providers';
import { apiClient } from '@borradh-workspace/api-client';
import { invitationResponseSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Invite member input type
 */
export interface InviteMemberInput {
  email: string;
  role?: 'member' | 'admin';
}

/**
 * Invitation response type
 */
export interface InvitationResponse {
  id: string;
  organizationId: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: string;
  inviterId: string;
}

/**
 * Invite Member Hook
 * Invites a new member to an organization via NestJS API
 *
 * @param organizationId - The organization ID
 * @param options.onSuccess - Custom success callback
 * @param options.onError - Custom error callback
 */
export const useInviteMember = (
  organizationId: string,
  options?: {
    onSuccess?: (data: InvitationResponse) => void;
    onError?: (error: Error) => void;
  }
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (data: InviteMemberInput) => {
      return apiClient.post<InvitationResponse>(
        `organizations/${organizationId}/invitations`,
        data,
        { schema: invitationResponseSchema }
      );
    },
    onSuccess: (data) => {
      trackEvent('team_member_invited', { role: data.role });
      // Invalidate members query
      queryClient.invalidateQueries({
        queryKey: ['organization', organizationId, 'members'],
      });

      toast.success('Invitation sent successfully');

      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to send invitation');
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
