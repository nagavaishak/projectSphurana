// Organization feature barrel export

// API hooks
export {
  // Get active organization
  useGetActiveOrganization,
  useActiveOrganization,
  getActiveOrganizationQueryOptions,
  // Update organization
  useUpdateOrganization,
  buildUpdateOrganizationPayload,
  updateOrganizationBodySchema,
  type UpdateOrganizationBody,
  type UpdateOrganizationIntent,
  type OrganizationPrimaryCalendarType,
  // List organizations
  useListOrganizations,
  listOrganizationsQueryOptions,
  // Create organization
  useCreateOrganization,
  type CreateOrganizationInput,
  type CreateOrganizationResponse,
  // Get organization
  useGetOrganization,
  getOrganizationQueryOptions,
  type OrganizationResponse,
  // Get organization brand
  useGetOrganizationBrand,
  getOrganizationBrandQueryOptions,
  type OrganizationBrandResponse,
  type ContentStyleTemplateId,
  // Get organization members
  useGetOrganizationMembers,
  getOrganizationMembersQueryOptions,
  type OrganizationMemberResponse,
  // Invite member
  useInviteMember,
  type InviteMemberInput,
  type InvitationResponse,
  // Remove member
  useRemoveMember,
  type RemoveMemberResponse,
  // Set active organization
  useSetActiveOrganization,
  setActiveOrganizationIfNeeded,
  type SetActiveOrganizationInput,
  // Onboarding tasks
  useGetOnboardingTasks,
  getOnboardingTasksQueryOptions,
  useCompleteOnboardingTask,
  type GetOnboardingTasksResponse,
  type OnboardingTaskStatus,
  type CompleteOnboardingTaskInput,
  type CompleteOnboardingTaskResponse,
  // Pending invitations
  useListPendingInvitations,
  listPendingInvitationsQueryOptions,
  type PendingInvitationResponse,
  // Accept invitation
  useAcceptInvitation,
  type AcceptInvitationResponse,
} from './api';

// Components
export { PendingInvitationsBanner } from './components';
