// Organizations feature barrel export

// Services
export {
  // create-organization
  createOrganization,
  createOrganizationSchema,
  type CreateOrganizationInput,
  type CreateOrganizationResponse,
  type CreateOrganizationResult,
  // get-organization
  getOrganization,
  getOrganizationSchema,
  type GetOrganizationInput,
  type GetOrganizationResponse,
  type GetOrganizationResult,
  // get-active-organization
  getActiveOrganization,
  getActiveOrganizationSchema,
  type GetActiveOrganizationInput,
  type GetActiveOrganizationResult,
  type GetActiveOrganizationResponse,
  type GetActiveOrganizationAuthApi,
  // update-organization
  updateOrganization,
  updateOrganizationSchema,
  updateOrganizationInternalSchema,
  type UpdateOrganizationInput,
  type UpdateOrganizationInternalInput,
  type UpdateOrganizationResult,
  type UpdateOrganizationResponse,
  type UpdateOrganizationAuthApi,
  // list-organizations
  listOrganizations,
  listOrganizationsSchema,
  type ListOrganizationsInput,
  type ListOrganizationsResult,
  type ListOrganizationsResponse,
  type ListOrganizationsAuthApi,
  // get-organization-members
  getOrganizationMembers,
  getOrganizationMembersSchema,
  type GetOrganizationMembersInput,
  type OrganizationMemberResponse,
  type GetOrganizationMembersResult,
  // invite-member
  inviteMember,
  inviteMemberSchema,
  type InviteMemberInput,
  type InviteMemberResponse,
  type InviteMemberResult,
  // invite-practitioner
  invitePractitioner,
  invitePractitionerSchema,
  type InvitePractitionerData,
  type InvitePractitionerInput,
  type InvitePractitionerResult,
  // remove-member
  removeMember,
  removeMemberSchema,
  type RemoveMemberInput,
  type RemoveMemberResponse,
  type RemoveMemberResult,
  // accept-invitation
  acceptInvitation,
  acceptInvitationSchema,
  type AcceptInvitationInput,
  type AcceptInvitationResponse,
  type AcceptInvitationResult,
  // list-pending-invitations
  listPendingInvitations,
  listPendingInvitationsSchema,
  type ListPendingInvitationsInput,
  type PendingInvitationResponse,
  type ListPendingInvitationsResult,
  // get-invitation-by-token
  getInvitationByToken,
  getInvitationByTokenSchema,
  type GetInvitationByTokenInput,
  type InvitationByTokenResponse,
  type GetInvitationByTokenResult,
  // set-active-organization
  setActiveOrganization,
  setActiveOrganizationSchema,
  type SetActiveOrganizationInput,
  type SetActiveOrganizationResponse,
  type SetActiveOrganizationResult,
  type SetActiveOrganizationAuthApi,
  // get-organization-by-api-key (legacy, kept for migration)
  getOrganizationByApiKey,
  getOrganizationByApiKeySchema,
  type GetOrganizationByApiKeyInput,
  type OrganizationByApiKeyResponse,
  type GetOrganizationByApiKeyResult,
  // get-organization-brand
  getOrganizationBrand,
  getOrganizationBrandSchema,
  type GetOrganizationBrandInput,
  type GetOrganizationBrandResult,
  // get-primary-location
  getPrimaryLocation,
  getPrimaryLocationSchema,
  type GetPrimaryLocationInput,
  type GetPrimaryLocationResult,
  type OrgPrimaryLocation,
  // sync-organization-timezone
  syncOrganizationTimezone,
  syncOrganizationTimezoneSchema,
  type SyncOrganizationTimezoneInput,
  type SyncOrganizationTimezoneResult,
  // update-organization-settings
  updateOrganizationSettings,
  updateOrganizationSettingsSchema,
  CONTENT_STYLE_TEMPLATES,
  type UpdateOrganizationSettingsInput,
  type UpdateOrganizationSettingsResult,
  type OrganizationSettingsResponse,
  // complete-onboarding-task
  completeOnboardingTask,
  completeOnboardingTaskSchema,
  type CompleteOnboardingTaskInput,
  type CompleteOnboardingTaskResponse,
  type CompleteOnboardingTaskResult,
  // get-onboarding-tasks
  getOnboardingTasks,
  getOnboardingTasksSchema,
  type GetOnboardingTasksInput,
  type GetOnboardingTasksResponse,
  type GetOnboardingTasksResult,
  type OnboardingTaskStatus,
  // check-member-access
  checkMemberAccess,
  checkMemberAccessSchema,
  type CheckMemberAccessInput,
  type CheckMemberAccessResult,
  type MemberAccessResult,
  // check-admin-access
  checkAdminAccess,
  checkAdminAccessSchema,
  type CheckAdminAccessInput,
  type CheckAdminAccessResult,
  type AdminAccessResult,
  // delete-organization
  deleteOrganization,
  deleteOrganizationSchema,
  type DeleteOrganizationInput,
  type DeleteOrganizationResult,
  type DeleteOrganizationResponse,
  // get-organization-calendar-settings
  getOrganizationCalendarSettings,
  type OrganizationCalendarSettings,
  // update-chatbot-settings
  updateChatbotSettings,
  updateChatbotSettingsSchema,
  type UpdateChatbotSettingsInput,
  type UpdateChatbotSettingsResult,
  type UpdateChatbotSettingsResponse,
  // resolve-privacy-policy-url
  resolvePrivacyPolicyUrl,
  resolveOrgPrivacyPolicyUrl,
  type PrivacyPolicySource,
} from './services/index.js';

// Models
export type {
  Organization,
  OrganizationMember,
  OrganizationRole,
} from './models/index.js';
