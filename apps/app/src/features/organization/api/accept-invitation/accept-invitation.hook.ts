import { trackEvent } from '@/components/providers';
import { invalidateKeys, queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export interface AcceptInvitationResponse {
  memberId: string;
  organizationId: string;
  userId: string;
  role: string;
}

/**
 * Accept-invitation input. `invitationId` identifies the invite; `acceptedTerms`
 * records the Terms/Privacy agreement from the invited-member Review step. The
 * banner path (an already-onboarded member accepting a second-org invite) omits
 * it — they agreed at their own sign-up.
 */
export interface AcceptInvitationInput {
  invitationId: string;
  acceptedTerms?: boolean;
}

interface UseAcceptInvitationOptions {
  onSuccess?: (response: AcceptInvitationResponse) => void;
  onError?: (error: Error) => void;
}

export const useAcceptInvitation = (options?: UseAcceptInvitationOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ invitationId, acceptedTerms }: AcceptInvitationInput) =>
      apiClient.post<AcceptInvitationResponse>(
        `organizations/invitations/${invitationId}/accept`,
        acceptedTerms === undefined ? {} : { acceptedTerms }
      ),
    onSuccess: (response) => {
      trackEvent('invitation_accepted');
      // The user just joined an org, so their org list has to be refetched.
      // This used to invalidate `['organizations']` (plural) — the real root is
      // `['organization', 'list']`, so the list never refreshed.
      invalidateKeys(
        queryClient,
        queryKeys.invitations.pending(),
        queryKeys.organization.list(),
        queryKeys.organization.members(response.organizationId)
      );
      toast.success('Invitation accepted! You have joined the team.');
      options?.onSuccess?.(response);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to accept invitation');
      options?.onError?.(error);
    },
  });

  return {
    acceptInvitation: mutation.mutate,
    acceptInvitationAsync: mutation.mutateAsync,
    isAccepting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
