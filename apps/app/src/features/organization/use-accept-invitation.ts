import { apiClient } from '@borradh-workspace/api-client';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

export interface AcceptInvitationResponse {
  memberId: string;
  organizationId: string;
  userId: string;
  role: string;
}

interface UseAcceptInvitationOptions {
  onSuccess?: (response: AcceptInvitationResponse) => void;
  onError?: (error: Error) => void;
}

export function useAcceptInvitation(options?: UseAcceptInvitationOptions) {
  const mutation = useMutation({
    mutationFn: (invitationId: string) =>
      apiClient.post<AcceptInvitationResponse>(
        `organizations/invitations/${invitationId}/accept`,
        {}
      ),
    onSuccess: (response) => {
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
    isAccepting: mutation.isPending,
  };
}
