import type {
  AppointmentResourceSource,
  Resource,
  ResourceCategory,
  ResourceCategoryKind,
} from '@borradh-workspace/database';

/**
 * A category plus how many non-deleted resources sit in it — the settings list
 * shows the count next to every category, and the delete guard reads the same
 * number.
 */
export interface ResourceCategoryWithCount extends ResourceCategory {
  /**
   * Resources in this category AT THE BRANCH being viewed (org-wide when no
   * branch is given). Drives whether a room picker is offered.
   */
  resourceCount: number;
  /**
   * The org-wide number — what `deleteResourceCategory` enforces. Equal to
   * `resourceCount` when no branch is given. When it is LARGER, the category
   * has resources at other branches, so "0 here" does not mean "deletable".
   */
  resourceCountAllBranches: number;
}

/** A resource with the category the settings/calendar UI groups it under. */
export interface ResourceWithCategory extends Resource {
  category: {
    id: string;
    name: string;
    kind: ResourceCategoryKind;
  };
}

/** One "service X needs a resource from category Y" rule, resolved for display. */
export interface ServiceResourceRequirementView {
  categoryId: string;
  categoryName: string;
  categoryKind: ResourceCategoryKind;
  /**
   * EMPTY means "any resource in this category" — the same org-wide-by-default
   * convention `blocked_time` uses for its practitioner joins.
   */
  eligibleResourceIds: string[];
}

/** The full requirement set for one service, plus its turnaround buffer. */
export interface ServiceResourceRequirements {
  serviceId: string;
  turnaroundMinutes: number | null;
  requirements: ServiceResourceRequirementView[];
}

/**
 * An allocation hydrated for the rooms calendar.
 *
 * `startDate`/`endDate` describe the HOLD, not the appointment: `endDate`
 * already includes `turnaroundMinutes`, which is carried separately so the
 * calendar can render the cleanup tail as a hatched extension rather than as
 * bookable time.
 */
export interface AppointmentResourceAllocationView {
  id: string;
  appointmentId: string;
  resourceId: string;
  resourceName: string;
  resourceColor: string | null;
  categoryId: string;
  startDate: Date;
  endDate: Date;
  turnaroundMinutes: number;
  source: AppointmentResourceSource;
  allowOverlap: boolean;
}

/** One resource's utilisation over a reporting range. */
export interface ResourceUtilisationRow {
  resourceId: string;
  resourceName: string;
  categoryId: string;
  categoryName: string;
  /** Minutes the resource was OPEN — its own hours, else the location's. */
  openMinutes: number;
  /** Minutes held by allocations, INCLUDING turnaround (it occupies the room). */
  bookedMinutes: number;
  /** bookedMinutes / openMinutes, 0..1. Exactly 0 (never NaN) when openMinutes is 0. */
  utilisation: number;
  /** Revenue attributed to this resource, in cents. */
  revenueCents: number;
  /** revenueCents per OPEN hour. 0 when openMinutes is 0. */
  revenuePerOpenHourCents: number;
}

export interface ResourceUtilisationResponse {
  from: Date;
  to: Date;
  rows: ResourceUtilisationRow[];
}
