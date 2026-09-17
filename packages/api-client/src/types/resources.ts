/**
 * @borradh-workspace/api-client — Rooms & Equipment (resource scheduling) API types.
 *
 * Derived from the backend, never duplicated. Following
 * .claude/rules/_patterns/type-sharing.md:
 *  - enum types derive from the LABEL RECORDS (`keyof typeof xLabels`) so the
 *    values and their display text can never drift apart;
 *  - response types wrap the backend row in `Serialize<T>` (Date → string);
 *  - input types `Omit` the server-supplied fields the client must not send.
 */

// Label records are runtime VALUES — the frontend renders dropdowns from them.
// Imported via features/shared, NOT from database directly: that indirection
// exists precisely to keep drizzle/postgres out of the web + mobile bundles.
import {
  appointmentResourceSourceLabels,
  appointmentResourceSourceValues,
  resourceAssignmentModeLabels,
  resourceAssignmentModeValues,
  resourceCategoryKindLabels,
  resourceCategoryKindPluralLabels,
  resourceCategoryKindRequiresLabels,
  resourceCategoryKindSingularLabels,
  resourceCategoryKindValues,
  resourceCountLabel,
} from '@borradh-workspace/features/shared';

// The category cap, so the UI can stop offering an action the API will refuse.
// Via features/shared (which re-exports the leaf labels package) — importing it
// from features/resources is a RUNTIME edge into server code.
export { MAX_RESOURCE_CATEGORIES } from '@borradh-workspace/features/shared';

import type {
  ResourceCategoryWithCount as BackendResourceCategoryWithCount,
  ResourceWithCategory as BackendResourceWithCategory,
  ServiceResourceRequirementView as BackendServiceResourceRequirementView,
  ServiceResourceRequirements as BackendServiceResourceRequirements,
} from '@borradh-workspace/features/resources';

import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES — derived from the label records (single source of truth)
// ============================================================================

export type ResourceCategoryKind = keyof typeof resourceCategoryKindLabels;
export type ResourceAssignmentMode = keyof typeof resourceAssignmentModeLabels;
export type AppointmentResourceSource =
  keyof typeof appointmentResourceSourceLabels;

// Re-exported for the frontend (select options, chips, empty-state copy).
export {
  appointmentResourceSourceLabels,
  appointmentResourceSourceValues,
  resourceAssignmentModeLabels,
  resourceAssignmentModeValues,
  resourceCategoryKindLabels,
  resourceCategoryKindPluralLabels,
  resourceCategoryKindRequiresLabels,
  resourceCategoryKindSingularLabels,
  resourceCategoryKindValues,
  resourceCountLabel,
};

// ============================================================================
// ENTITIES
// ============================================================================

/** A category plus its non-deleted resource count (settings list + delete guard). */
export type ResourceCategory = Serialize<BackendResourceCategoryWithCount>;

/** A resource with the category the settings/calendar UI groups it under. */
export type Resource = Serialize<BackendResourceWithCategory>;

/**
 * Weekly availability for a resource. Keys are day-of-week (0=Sunday..6),
 * values are minutes from midnight. Same shape as practitioner working hours,
 * which is what lets the rooms calendar reuse the practitioner off-hours hatch.
 *
 * `null` on a resource means ALWAYS AVAILABLE — it inherits the clinic's hours.
 * (Deliberately unlike Boulevard, where a resource without a schedule is
 * silently never bookable.)
 */
export type ResourceWorkingHours = Record<number, { from: number; to: number }>;

/** Clinic-defined display-only key/values ("Size": "3.5 x 4m"). */
export type ResourceSpecs = Record<string, string>;

export type ServiceResourceRequirementView =
  BackendServiceResourceRequirementView;
export type ServiceResourceRequirements =
  Serialize<BackendServiceResourceRequirements>;

// ============================================================================
// INPUTS — organizationId is supplied server-side from the session, never sent
// ============================================================================

export interface CreateResourceCategoryInput {
  name: string;
  kind?: ResourceCategoryKind;
  description?: string | null;
  sortOrder?: number;
}

export type UpdateResourceCategoryInput =
  Partial<CreateResourceCategoryInput> & {
    isActive?: boolean;
  };

export interface CreateResourceInput {
  categoryId: string;
  name: string;
  description?: string | null;
  color?: string | null;
  photo?: string | null;
  /** How many appointments can occupy this resource at once. Default 1. */
  capacity?: number;
  specs?: ResourceSpecs | null;
  /** null = always available. */
  workingHours?: ResourceWorkingHours | null;
  locationId?: string | null;
  sortOrder?: number;
}

export type UpdateResourceInput = Partial<CreateResourceInput> & {
  isActive?: boolean;
};

export interface ReorderResourcesInput {
  items: Array<{ id: string; sortOrder: number }>;
}

/**
 * Replaces a service's ENTIRE requirement set.
 *
 * An empty `eligibleResourceIds` means "any resource in this category" and
 * writes zero eligibility rows — the org-wide-by-default convention used
 * throughout scheduling. Sending an empty array is NOT the same as omitting
 * the requirement.
 */
export interface SetServiceResourceRequirementsInput {
  turnaroundMinutes?: number | null;
  requirements: Array<{
    categoryId: string;
    eligibleResourceIds: string[];
  }>;
}

// ============================================================================
// ALLOCATIONS + BOOKING FEEDBACK
// ============================================================================

/** A resource held for an appointment, hydrated for the calendar. */
export interface AppointmentResourceAllocation {
  id: string;
  appointmentId: string;
  resourceId: string;
  resourceName: string;
  resourceColor: string | null;
  categoryId: string;
  /** ISO. Hold START — equals the appointment start. */
  startDate: string;
  /** ISO. Hold END — appointment end PLUS `turnaroundMinutes`. */
  endDate: string;
  /** Minutes of the range that are turnaround (rendered as a hatched tail). */
  turnaroundMinutes: number;
  source: AppointmentResourceSource;
  /** True when this allocation knowingly overlaps another (staff override, or capacity > 1). */
  allowOverlap: boolean;
}

/**
 * Returned by create/update-appointment when a STAFF booking was allowed to
 * proceed despite a resource clash (warn-don't-block). Online bookings never
 * produce a warning — they hard-fail with a CONFLICT instead.
 */
export interface ResourceWarning {
  categoryId: string;
  categoryName: string;
  resourceId: string;
  resourceName: string;
  conflictingAppointmentTitle: string;
  /** ISO */
  conflictStart: string;
  /** ISO */
  conflictEnd: string;
}

// ============================================================================
// UTILISATION REPORT
// ============================================================================

export interface ResourceUtilisationRow {
  resourceId: string;
  resourceName: string;
  categoryId: string;
  categoryName: string;
  /** Minutes the resource was open in the range (its own hours, else the location's). */
  openMinutes: number;
  /** Minutes held by allocations, INCLUDING turnaround — it occupies the room. */
  bookedMinutes: number;
  /** bookedMinutes / openMinutes, 0..1. 0 (never NaN) when openMinutes is 0. */
  utilisation: number;
  /** Revenue attributed to this resource, in cents. Split evenly across an appointment's resources. */
  revenueCents: number;
  /** revenueCents per open hour. 0 when openMinutes is 0. */
  revenuePerOpenHourCents: number;
}

export interface ResourceUtilisationResponse {
  /** ISO date (inclusive). */
  from: string;
  /** ISO date (exclusive). */
  to: string;
  rows: ResourceUtilisationRow[];
}
