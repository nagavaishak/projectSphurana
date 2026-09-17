import { apiClient } from '@borradh-workspace/api-client';
import type { InvitePractitionerRequest } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { queryKeys } from '@/lib/query-keys';

interface InvitePractitionerResponse {
  invitationId: string;
  email: string;
  /** True when an existing pending invitation was re-sent rather than created. */
  resent: boolean;
}

interface UseInvitePractitionerOptions {
  onSuccess?: (result: InvitePractitionerResponse) => void;
}

/**
 * Sends — or re-sends — a team member's invitation email.
 *
 * The toast names the address it went to. "Invited" in the members table only
 * means "no linked account yet", so the owner has no other way to tell a
 * successful send from a silent no-op; echoing the recipient back is the
 * confirmation. The API returns an error (not a success) when the mail provider
 * rejects the send, so a red toast here means nothing was delivered.
 */
export const useInvitePractitioner = (
  options?: UseInvitePractitionerOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, ...body }: InvitePractitionerRequest & { id: string }) =>
      apiClient.post<InvitePractitionerResponse>(
        `practitioners/${id}/invite`,
        body
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.practitioners.all(),
      });
      toast.success(
        result.resent
          ? `Invitation re-sent to ${result.email}`
          : `Invitation sent to ${result.email}`
      );
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to send invitation');
    },
  });

  return {
    invitePractitioner: mutation.mutate,
    invitePractitionerAsync: mutation.mutateAsync,
    isInviting: mutation.isPending,
  };
};
