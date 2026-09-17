import { apiClient } from '@borradh-workspace/api-client';
import type { Practitioner } from '@borradh-workspace/api-client/types';
import type {
  CreateTeamMemberRequest,
  TeamMemberWageConfigRequest,
} from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Partial wage-config patch the composite create accepts.
 *
 * NOT declared here — it is the canonical `TeamMemberWageConfigRequest` from
 * `@borradh-workspace/contracts`, the same shape the backend's
 * `teamMemberWageConfigSchema` re-exports. Rates are cents; automation settings
 * use the three-value workspace-default/enabled/disabled enum.
 * `locationRestriction` is stored now, enforced later (see add-team-member spec
 * §4/§8.4).
 */
export type TeamMemberWageConfigPayload = TeamMemberWageConfigRequest;

/**
 * Payload for `POST /practitioners/team-member` — the composite "Add team
 * member" create.
 *
 * NOT declared here either: it is the canonical `CreateTeamMemberRequest`, the
 * same object the backend's `createTeamMemberSchema` extends with
 * `organizationId` + `inviterId` and the API DTO validates against. The
 * hand-written interface this replaced was a mirror maintained by hand, which is
 * exactly the drift the contracts package exists to remove.
 *
 * Note `permissionLevel` is REQUIRED here: this is the contract's parsed
 * (output) shape, in which the `.default('low')` has already materialised. The
 * one builder always supplies it, so nothing relies on the default.
 */
export type CreateTeamMemberPayload = CreateTeamMemberRequest;

interface UseCreateTeamMemberOptions {
  onSuccess?: (practitioner: Practitioner) => void;
  onError?: (error: Error) => void;
}

/**
 * Creates a team member in one composite call: the practitioner record, its
 * service + location assignments, wage config, and the invitation carrying the
 * chosen permission level. Invalidates the practitioners list on success.
 */
export const useCreateTeamMember = (options?: UseCreateTeamMemberOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreateTeamMemberPayload) =>
      apiClient.post<Practitioner>('practitioners/team-member', input),
    onSuccess: (practitioner) => {
      queryClient.invalidateQueries({ queryKey: ['practitioners'] });
      toast.success('Team member added');
      options?.onSuccess?.(practitioner);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to add team member');
      options?.onError?.(error);
    },
  });

  return {
    createTeamMember: mutation.mutate,
    createTeamMemberAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
