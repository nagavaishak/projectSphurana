// create-organization
export {
  createOrganization,
  createOrganizationSchema,
  type CreateOrganizationInput,
  type CreateOrganizationResponse,
  type CreateOrganizationResult,
} from './create-organization/index.js';

// get-organization
export {
  getOrganization,
  getOrganizationSchema,
  type GetOrganizationInput,
  type GetOrganizationResponse,
  type GetOrganizationResult,
} from './get-organization/index.js';

// get-active-organization
export {
  getActiveOrganization,
  getActiveOrganizationSchema,
  type GetActiveOrganizationInput,
  type GetActiveOrganizationResult,
  type GetActiveOrganizationResponse,
  type GetActiveOrganizationAuthApi,
} from './get-active-organization/index.js';

// update-organization
export {
  updateOrganization,
  updateOrganizationSchema,
  updateOrganizationInternalSchema,
  type UpdateOrganizationInput,
  type UpdateOrganizationInternalInput,
  type UpdateOrganizationResult,
  type UpdateOrganizationResponse,
  type UpdateOrganizationAuthApi,
} from './update-organization/index.js';

// list-organizations
export {
  listOrganizations,
  listOrganizationsSchema,
  type ListOrganizationsInput,
  type ListOrganizationsResult,
  type ListOrganizationsResponse,
  type ListOrganizationsAuthApi,
} from './list-organizations/index.js';

// get-organization-members
export {
  getOrganizationMembers,
  getOrganizationMembersSchema,
  type GetOrganizationMembersInput,
  type OrganizationMemberResponse,
  type GetOrganizationMembersResult,
} from './get-organization-members/index.js';

// invite-member
export {
  inviteMember,
  inviteMemberSchema,
  type InviteMemberInput,
  type InviteMemberResponse,
  type InviteMemberResult,
} from './invite-member/index.js';

// invite-practitioner
export {
  invitePractitioner,
  invitePractitionerSchema,
  type InvitePractitionerData,
  type InvitePractitionerInput,
  type InvitePractitionerResult,
} from './invite-practitioner/index.js';

// remove-member
export {
  removeMember,
  removeMemberSchema,
  type RemoveMemberInput,
  type RemoveMemberResponse,
  type RemoveMemberResult,
} from './remove-member/index.js';

// accept-invitation
export {
  acceptInvitation,
  acceptInvitationSchema,
  type AcceptInvitationInput,
  type AcceptInvitationResponse,
  type AcceptInvitationResult,
} from './accept-invitation/index.js';

// list-pending-invitations
export {
  listPendingInvitations,
  listPendingInvitationsSchema,
  type ListPendingInvitationsInput,
  type PendingInvitationResponse,
  type ListPendingInvitationsResult,
} from './list-pending-invitations/index.js';

// get-invitation-by-token
export {
  getInvitationByToken,
  getInvitationByTokenSchema,
  type GetInvitationByTokenInput,
  type InvitationByTokenResponse,
  type GetInvitationByTokenResult,
} from './get-invitation-by-token/index.js';

// set-active-organization
export {
  setActiveOrganization,
  setActiveOrganizationSchema,
  type SetActiveOrganizationInput,
  type SetActiveOrganizationResponse,
  type SetActiveOrganizationResult,
  type SetActiveOrganizationAuthApi,
} from './set-active-organization/index.js';

// get-organization-by-api-key (legacy - kept for migration from old system)
export {
  getOrganizationByApiKey,
  getOrganizationByApiKeySchema,
  type GetOrganizationByApiKeyInput,
  type OrganizationByApiKeyResponse,
  type GetOrganizationByApiKeyResult,
} from './get-organization-by-api-key/index.js';

// get-organization-brand
export {
  getOrganizationBrand,
  getOrganizationBrandSchema,
  type GetOrganizationBrandInput,
  type GetOrganizationBrandResult,
} from './get-organization-brand/index.js';

// get-primary-location
export {
  getPrimaryLocation,
  getPrimaryLocationSchema,
  type GetPrimaryLocationInput,
  type GetPrimaryLocationResult,
  type OrgPrimaryLocation,
} from './get-primary-location/index.js';

// sync-organization-timezone
export {
  syncOrganizationTimezone,
  syncOrganizationTimezoneSchema,
  type SyncOrganizationTimezoneInput,
  type SyncOrganizationTimezoneResult,
} from './sync-organization-timezone/index.js';

// update-organization-settings
export {
  updateOrganizationSettings,
  updateOrganizationSettingsSchema,
  CONTENT_STYLE_TEMPLATES,
  type UpdateOrganizationSettingsInput,
  type UpdateOrganizationSettingsResult,
  type OrganizationSettingsResponse,
} from './update-organization-settings/index.js';

// complete-onboarding-task
export {
  completeOnboardingTask,
  completeOnboardingTaskSchema,
  type CompleteOnboardingTaskInput,
  type CompleteOnboardingTaskResponse,
  type CompleteOnboardingTaskResult,
} from './complete-onboarding-task/index.js';

// get-onboarding-tasks
export {
  getOnboardingTasks,
  getOnboardingTasksSchema,
  type GetOnboardingTasksInput,
  type GetOnboardingTasksResponse,
  type GetOnboardingTasksResult,
  type OnboardingTaskStatus,
} from './get-onboarding-tasks/index.js';

// check-member-access
export {
  checkMemberAccess,
  checkMemberAccessSchema,
  type CheckMemberAccessInput,
  type CheckMemberAccessResult,
  type MemberAccessResult,
} from './check-member-access/index.js';

// check-admin-access
export {
  checkAdminAccess,
  checkAdminAccessSchema,
  type CheckAdminAccessInput,
  type CheckAdminAccessResult,
  type AdminAccessResult,
} from './check-admin-access/index.js';

// delete-organization
export {
  deleteOrganization,
  deleteOrganizationSchema,
  type DeleteOrganizationInput,
  type DeleteOrganizationResult,
  type DeleteOrganizationResponse,
} from './delete-organization/index.js';

// get-organization-calendar-settings
export {
  getOrganizationCalendarSettings,
  type OrganizationCalendarSettings,
} from './get-organization-calendar-settings/index.js';

// update-chatbot-settings
export {
  updateChatbotSettings,
  updateChatbotSettingsSchema,
  type UpdateChatbotSettingsInput,
  type UpdateChatbotSettingsResult,
  type UpdateChatbotSettingsResponse,
} from './update-chatbot-settings/index.js';

// resolve-privacy-policy-url
export {
  resolvePrivacyPolicyUrl,
  resolveOrgPrivacyPolicyUrl,
  type PrivacyPolicySource,
} from './resolve-privacy-policy-url/index.js';
