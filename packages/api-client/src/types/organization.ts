/**
 * @borradh-workspace/api-client - Organization API Types
 *
 * Types for organization-related API endpoints and enums.
 * Types are derived from database package - the source of truth.
 */

// Import types from features/shared (isolatedModules compliant - separate imports)
import type {
  Organization as BackendOrganization,
  OrganizationMember as BackendOrganizationMember,
  OnboardingTask,
  OrganizationRole,
  TeamPermissionLevel,
} from '@borradh-workspace/features/shared';

import type {
  AcceptInvitationInput as BackendAcceptInvitationInput,
  AcceptInvitationResponse as BackendAcceptInvitationResponse,
  InviteMemberInput as BackendInviteMemberInput,
  InviteMemberResponse as BackendInviteMemberResponse,
  PendingInvitationResponse as BackendPendingInvitationResponse,
} from '@borradh-workspace/features/organizations';

import type { Serialize } from './serialization.js';

// Import labels and values from features/shared (runtime values)
import {
  businessTypeLabels,
  businessTypeValues,
  contentStyleTemplateLabels,
  contentStyleTemplateValues,
  countryCodeLabels,
  countryCodeValues,
  onboardingTaskLabels,
  onboardingTaskValues,
  outroStyleLabels,
  outroStyleValues,
  permissionLevelToRole,
  primaryCalendarTypeLabels,
  primaryCalendarTypeValues,
  roleToPermissionLevel,
  stylePreferenceLabels,
  stylePreferenceValues,
  teamPermissionLevelLabels,
  teamPermissionLevelValues,
} from '@borradh-workspace/features/shared';

// Re-export types
export type { OnboardingTask, OrganizationRole, TeamPermissionLevel };

// ============================================================================
// ENTITY TYPES - Serialized for API responses (Date → string)
// ============================================================================

/**
 * Organization entity (API response - dates serialized to ISO strings)
 *
 * This is a curated subset of the database Organization type.
 * Sensitive fields like `apiKey` are intentionally excluded.
 */
export type Organization = Serialize<BackendOrganization>;

/**
 * Organization member entity (API response - dates serialized to ISO strings)
 */
export type OrganizationMember = Serialize<BackendOrganizationMember>;

// Derive types from labels (isolatedModules compliant)
export type BusinessType = keyof typeof businessTypeLabels;
export type ContentStyleTemplate = keyof typeof contentStyleTemplateLabels;
export type StylePreference = keyof typeof stylePreferenceLabels;
export type CountryCode = keyof typeof countryCodeLabels;
export type OutroStyle = keyof typeof outroStyleLabels;
export type PrimaryCalendarType = keyof typeof primaryCalendarTypeLabels;

// Re-export labels and values for frontend use
export {
  businessTypeLabels,
  businessTypeValues,
  contentStyleTemplateLabels,
  contentStyleTemplateValues,
  stylePreferenceLabels,
  stylePreferenceValues,
  countryCodeLabels,
  countryCodeValues,
  onboardingTaskLabels,
  onboardingTaskValues,
  outroStyleLabels,
  outroStyleValues,
  primaryCalendarTypeLabels,
  primaryCalendarTypeValues,
  teamPermissionLevelLabels,
  teamPermissionLevelValues,
  permissionLevelToRole,
  roleToPermissionLevel,
};

// ============================================================================
// INVITATION TYPES (invite / accept / public token lookup)
// ============================================================================

/**
 * Invitation response (API response - dates serialized to ISO strings).
 */
export type InviteMemberResponse = Serialize<BackendInviteMemberResponse>;

/**
 * Accept-invitation response.
 */
export type AcceptInvitationResponse =
  Serialize<BackendAcceptInvitationResponse>;

/**
 * Pending invitation (list) response.
 */
export type PendingInvitationResponse =
  Serialize<BackendPendingInvitationResponse>;

/**
 * Invite-member input.
 *
 * Derived from the backend schema minus server-supplied fields
 * (`organizationId` from session, `inviterId` from the current user), extended
 * with the prefill fields the owner types in the Profile panel so the invited
 * member's Review-and-confirm step can pre-populate them.
 *
 * TODO(phase-3): once `inviteMemberSchema` gains firstName/lastName/phone/
 * phoneCountry/country, fold the prefill fields into the backend schema and drop
 * the intersection below (derive purely via `Omit`).
 */
export type InviteMemberInput = Omit<
  BackendInviteMemberInput,
  'organizationId' | 'inviterId'
> & {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  phoneCountry?: string | null;
  country?: CountryCode | null;
  /** Permission level chosen in the Settings panel → member.role. */
  permissionLevel?: TeamPermissionLevel;
};

/**
 * Accept-invitation input.
 *
 * `userId` is supplied server-side from the authenticated (or freshly created)
 * session, so it is omitted here. The public accept flow additionally sets a
 * password + records terms acceptance; those land in Phase 3.
 *
 * TODO(phase-3): extend once the public accept flow schema (password + terms)
 * is finalized.
 */
export type AcceptInvitationInput = Omit<
  BackendAcceptInvitationInput,
  'userId'
>;

/**
 * Public invitation-by-token lookup response.
 *
 * Returned by `GET /organizations/invitations/token/:token` (no auth, scoped by
 * the opaque token only) to power the Join / Review-and-confirm screens. Surfaces
 * the invite + org name + inviter name + the prefill fields the owner entered —
 * and nothing beyond the invitation.
 *
 * TODO(phase-3): derive from the `getInvitationByToken` feature response type
 * once that service exists. Defined structurally for now.
 */
export interface InvitationByTokenResponse {
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: string; // ISO string
  organizationId: string;
  organizationName: string;
  inviterName: string | null;
  // Prefill fields (from the owner's Profile-panel inputs, stored on invitation)
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  phoneCountry: string | null;
  country: string | null;
}
