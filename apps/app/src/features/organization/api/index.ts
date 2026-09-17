// Create organization
export {
  useCreateOrganization,
  type CreateOrganizationInput,
  type CreateOrganizationResponse,
} from './create-organization';

// Get organization
export {
  useGetOrganization,
  getOrganizationQueryOptions,
  type OrganizationResponse,
} from './get-organization';

// Get active organization
export {
  useGetActiveOrganization,
  useActiveOrganization,
  getActiveOrganizationQueryOptions,
} from './get-active-organization';

// Update organization
export {
  type OrganizationPrimaryCalendarType,
  type UpdateOrganizationBody,
  type UpdateOrganizationIntent,
  buildUpdateOrganizationPayload,
  updateOrganizationBodySchema,
  useUpdateOrganization,
} from './update-organization';

// List organizations
export {
  useListOrganizations,
  listOrganizationsQueryOptions,
} from './list-organizations';

// Get organization members
export {
  useGetOrganizationMembers,
  getOrganizationMembersQueryOptions,
  type OrganizationMemberResponse,
} from './get-organization-members';

// Invite member
export {
  useInviteMember,
  type InviteMemberInput,
  type InvitationResponse,
} from './invite-member';

// Remove member
export {
  useRemoveMember,
  type RemoveMemberResponse,
} from './remove-member';

// Set active organization
export {
  useSetActiveOrganization,
  setActiveOrganizationIfNeeded,
  type SetActiveOrganizationInput,
} from './set-active-organization';

// Get organization brand
export {
  useGetOrganizationBrand,
  getOrganizationBrandQueryOptions,
  type OrganizationBrandResponse,
  type ContentStyleTemplateId,
} from './get-organization-brand';

// Onboarding tasks
export {
  useGetOnboardingTasks,
  getOnboardingTasksQueryOptions,
  type GetOnboardingTasksResponse,
  type OnboardingTaskStatus,
} from './get-onboarding-tasks';

export {
  useCompleteOnboardingTask,
  type CompleteOnboardingTaskInput,
  type CompleteOnboardingTaskResponse,
} from './complete-onboarding-task';

// List pending invitations
export {
  useListPendingInvitations,
  listPendingInvitationsQueryOptions,
  type PendingInvitationResponse,
} from './list-pending-invitations';

// Accept invitation
export {
  useAcceptInvitation,
  type AcceptInvitationResponse,
  type AcceptInvitationInput,
} from './accept-invitation';

// Get invitation by token (public)
export {
  useInvitationByToken,
  getInvitationByTokenQueryOptions,
} from './get-invitation-by-token';
