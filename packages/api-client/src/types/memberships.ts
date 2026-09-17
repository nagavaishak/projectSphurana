/**
 * @borradh-workspace/api-client - Memberships API Types
 *
 * Types for the membership-plans / lead-memberships API endpoints.
 * Types are derived from backend packages - database types and features schemas.
 */

// Import types from features/shared (isolatedModules compliant - separate imports)
import type {
  LeadMembershipStatus,
  MembershipPricingType,
  MembershipValidFor,
} from '@borradh-workspace/features/shared';

// Import labels and values from features/shared (runtime values)
import {
  leadMembershipStatusLabels,
  leadMembershipStatusValues,
  membershipPricingTypeLabels,
  membershipPricingTypeValues,
  membershipValidForLabels,
  membershipValidForValues,
} from '@borradh-workspace/features/shared';

// Import backend entity types from features
import type {
  LeadMembership as BackendLeadMembership,
  LeadMembershipWithPlan as BackendLeadMembershipWithPlan,
  MembershipPlan as BackendMembershipPlan,
  MembershipPlanWithServices as BackendMembershipPlanWithServices,
} from '@borradh-workspace/features/memberships';

// Import backend input types from features
import type {
  CreateMembershipPlanInput as BackendCreateMembershipPlanInput,
  ListLeadMembershipsInput as BackendListLeadMembershipsInput,
  UpdateMembershipPlanInput as BackendUpdateMembershipPlanInput,
} from '@borradh-workspace/features/memberships';

import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES - Re-exported from database (Labels pattern)
// ============================================================================

export type { MembershipPricingType, MembershipValidFor, LeadMembershipStatus };
export {
  membershipPricingTypeLabels,
  membershipPricingTypeValues,
  membershipValidForLabels,
  membershipValidForValues,
  leadMembershipStatusLabels,
  leadMembershipStatusValues,
};

// ============================================================================
// ENTITY TYPES - Serialized for API responses (Date → string)
// ============================================================================

export type MembershipPlan = Serialize<BackendMembershipPlan>;
export type MembershipPlanWithServices =
  Serialize<BackendMembershipPlanWithServices>;

/**
 * A listed plan plus the branches that sell it.
 *
 * EMPTY MEANS EVERY BRANCH — the empty-junction convention, not "sold
 * nowhere". LIST only, mirroring `ListedService`.
 */
export type ListedMembershipPlan = MembershipPlanWithServices & {
  locationIds: string[];
};
export type LeadMembership = Serialize<BackendLeadMembership>;
export type LeadMembershipWithPlan = Serialize<BackendLeadMembershipWithPlan>;

// ============================================================================
// RESPONSE TYPES - API-specific shapes
// ============================================================================

/** DELETE /membership-plans/:id response */
export interface DeleteMembershipPlanResponse {
  success: boolean;
  /** true = row removed; false = plan had sold memberships → deactivated. */
  deleted: boolean;
  deactivated: boolean;
}

// ============================================================================
// INPUT TYPES - Derived from backend, omitting server-side fields
// ============================================================================

/** Input for creating a membership plan (organizationId added by controller) */
export type CreateMembershipPlanInput = Omit<
  BackendCreateMembershipPlanInput,
  'organizationId'
>;

/** Input for updating a membership plan (planId comes from the route) */
export type UpdateMembershipPlanInput = Omit<
  BackendUpdateMembershipPlanInput,
  'organizationId' | 'planId'
>;

/** Query params for listing lead memberships */
export type ListLeadMembershipsInput = Omit<
  BackendListLeadMembershipsInput,
  'organizationId'
>;
