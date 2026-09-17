/**
 * @borradh-workspace/api-client - Practitioners API Types
 *
 * Types for practitioners (multi-staff booking) API endpoints.
 * Types are derived from backend packages - database schema and features schemas.
 */

import type {
  Practitioner as BackendPractitioner,
  PractitionerLocation as BackendPractitionerLocation,
  PractitionerService as BackendPractitionerService,
  CountryCode,
  EmploymentType,
  PractitionerSocialLinks,
  TeamPermissionLevel,
  UserColor,
  WorkingHours,
} from '@borradh-workspace/features/shared';

// Runtime label/value records + role-mapping helpers (source of truth =
// @borradh-workspace/labels, surfaced via features/shared).
import {
  employmentTypeLabels,
  employmentTypeValues,
  permissionLevelToRole,
  roleToPermissionLevel,
  teamPermissionLevelLabels,
  teamPermissionLevelValues,
} from '@borradh-workspace/features/shared';

import type {
  AssignPractitionerLocationsInput as BackendAssignLocationsInput,
  AssignPractitionerServicesInput as BackendAssignServicesInput,
  CreatePractitionerInput as BackendCreateInput,
  ListPractitionersInput as BackendListInput,
  LocationAssignment as BackendLocationAssignment,
  UpdatePractitionerInput as BackendUpdateInput,
} from '@borradh-workspace/features/practitioners';

import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES + LABELS (re-exported for frontend use)
// ============================================================================

export type { EmploymentType, TeamPermissionLevel, PractitionerSocialLinks };

export {
  employmentTypeLabels,
  employmentTypeValues,
  teamPermissionLevelLabels,
  teamPermissionLevelValues,
  permissionLevelToRole,
  roleToPermissionLevel,
};

// ============================================================================
// RE-EXPORT WORKING HOURS TYPE
// ============================================================================

export type { WorkingHours };

// ============================================================================
// ENTITY TYPES - Serialized for API responses (Date → string)
// ============================================================================

/**
 * Practitioner response type (API response - dates serialized to ISO strings)
 */
export type Practitioner = Serialize<BackendPractitioner>;

/**
 * Practitioner-Location junction (API response)
 */
export type PractitionerLocation = Serialize<BackendPractitionerLocation>;

/**
 * Practitioner-Service junction (API response)
 */
export type PractitionerService = Serialize<BackendPractitionerService>;

/**
 * Practitioner with related services and locations
 */
export interface PractitionerWithRelations extends Practitioner {
  services?: PractitionerService[];
  locations?: PractitionerLocation[];
}

// ============================================================================
// RESPONSE TYPES - API-specific shapes
// ============================================================================

/**
 * List practitioners response
 */
export interface ListPractitionersResponse {
  items: PractitionerWithRelations[];
  limit: number;
  offset: number;
}

// ============================================================================
// INPUT TYPES - Derived from backend, omitting server-side fields
// ============================================================================

/**
 * Create practitioner input
 * Omits organizationId (added by controller from session)
 */
export type CreatePractitionerInput = Omit<
  BackendCreateInput,
  'organizationId'
>;

/**
 * Update practitioner input
 * Omits id and organizationId (added by controller)
 */
export type UpdatePractitionerInput = Omit<
  BackendUpdateInput,
  'id' | 'organizationId'
>;

/**
 * List practitioners params
 * Omits organizationId (added by controller)
 */
export type ListPractitionersParams = Omit<BackendListInput, 'organizationId'>;

/**
 * Assign services input
 * Omits practitionerId and organizationId (from route/session)
 */
export type AssignPractitionerServicesInput = Omit<
  BackendAssignServicesInput,
  'practitionerId' | 'organizationId'
>;

/**
 * Location assignment (for assign-locations endpoint)
 */
export type LocationAssignment = BackendLocationAssignment;

/**
 * Assign locations input
 * Omits practitionerId and organizationId (from route/session)
 */
export type AssignPractitionerLocationsInput = Omit<
  BackendAssignLocationsInput,
  'practitionerId' | 'organizationId'
>;

// ============================================================================
// TEAM-MEMBER COMPOSITE INPUT TYPES
// ============================================================================
//
// The "Add team member" editor persists profile + work-detail + public-profile
// fields, service/location assignments, wage config, permission level, and the
// invite prefill in one composite call (see add-team-member spec §6 "Save
// semantics"). These input shapes are defined STRUCTURALLY here because their
// backend feature schemas (`createTeamMember`, extended create/update
// practitioner) do not exist yet.
//
// TODO(phase-3): once the feature services land, derive these from the backend
// Zod-inferred input types via `Omit<Backend, serverFields>` per
// type-sharing.md, and delete the structural definitions below.

/**
 * Profile + work-detail + public-profile fields shared by create/update.
 * Mirrors the new `practitioner` columns added in Phase 1.
 */
export interface TeamMemberProfileInput {
  // Profile
  firstName?: string | null;
  lastName?: string | null;
  email: string;
  phone?: string | null;
  phoneSecondary?: string | null;
  phoneCountry?: string | null;
  country?: CountryCode | null;
  photo?: string | null;
  title?: string | null;
  color?: UserColor | null;
  dateOfBirth?: string | null; // ISO date (yyyy-mm-dd)
  // Work details
  employmentStartDate?: string | null; // ISO date
  employmentEndDate?: string | null; // ISO date
  employmentType?: EmploymentType | null;
  teamMemberRef?: string | null;
  notes?: string | null;
  // Booking / settings
  acceptsBookings?: boolean;
  // Public profile (self-onboarding wizard)
  headline?: string | null;
  bio?: string | null;
  languages?: string[] | null;
  socialLinks?: PractitionerSocialLinks | null;
}

/**
 * Composite "Add team member" input.
 * Creates the practitioner, assigns services + locations, upserts the wage
 * config, and issues the invitation carrying the permission level + prefill.
 * `organizationId` is added by the controller from the session.
 *
 * TODO(phase-3): derive from the `createTeamMember` feature schema.
 */
export interface CreateTeamMemberInput extends TeamMemberProfileInput {
  /** Service IDs the member provides. */
  serviceIds?: string[];
  /** Location assignments ("works at"). */
  locations?: LocationAssignment[];
  /** Wage + timesheet config (see UpdateWageConfigInput in scheduling types). */
  wageConfig?: Record<string, unknown>;
  /** Permission level → member.role (owner is never assignable here). */
  permissionLevel?: TeamPermissionLevel;
}

/**
 * Composite team-member update input (per-panel PATCH or full save).
 * `id` + `organizationId` come from the route/session.
 *
 * TODO(phase-3): derive from the extended `updatePractitioner` feature schema.
 */
export type UpdateTeamMemberInput = Partial<CreateTeamMemberInput>;
