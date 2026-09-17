import type { ResourceCategoryKind } from '@borradh-workspace/labels';

/**
 * Resources (rooms & equipment) capability port.
 *
 * THE GAP, and why this is not optional. Gate 1's own doc comment states the
 * defect it was built to catch:
 *
 *   "`shifts` has 3 mutating endpoints and 0 tools — and shifts are the sole
 *    availability source, so Claire structurally could not fix an unbookable
 *    service."
 *
 * Shifts are no longer the sole availability source. A service can require a
 * room, and once it does, the room decides bookability exactly as the rota
 * does: no allocatable resource in a required category means every attempt to
 * book that service fails allocation, on every date, for every practitioner.
 * `AvailabilityPort.explainAvailability` can eventually SEE that; without this
 * port nothing can FIX it, and the sentence above applies verbatim to rooms.
 *
 * THE HONESTY RULE, applied to writes rather than reads.
 * `availability.port.ts` refuses to let a diagnosis be reported as complete
 * when a source went unread. The write equivalent is subtler and, in this
 * feature, much more likely: **a write can succeed at the row level and still
 * leave the service unbookable.** Two independent ways, neither of which is an
 * error, and both of which return 200 from the API:
 *
 *   1. A resource is saved but cannot hold a booking — it was deactivated, or
 *      its `workingHours` record names no open day. (`null` hours mean ALWAYS
 *      AVAILABLE, so absence is the safe case; an EMPTY schedule is the trap,
 *      and it is the one Boulevard ships as its default behaviour.)
 *   2. A requirement is applied naming a category with nothing in it that can
 *      satisfy it. The rule set is now exactly what was asked for, and the
 *      service is unbookable from the moment it saves.
 *
 * A `saved: true` boolean would be literally true in both cases and would send
 * an owner away believing their clinic was configured. So there is no boolean
 * here, and no optional error field: "saved and allocatable" and "saved and
 * unallocatable" are DIFFERENT MEMBERS, and `AllocatableResource` cannot be
 * constructed for a resource that is open on no day — its `opensOn` is a
 * non-empty tuple or the explicit `null` that means always-open.
 *
 * `setServiceRequirements` goes one step further, mirroring the
 * `read` / `partially_read` split next door: `applied` may only be returned
 * when every rule was CHECKED against the live resource list, so the absence
 * of an unsatisfiable rule is evidence. When that check could not run, the
 * rules are still written — but the outcome is `applied_unverified`, which
 * carries no claim about bookability at all.
 *
 * DATA SHAPES. Ports normally take their types from the atoms in
 * `../generated` / `../requests` / `../responses`. There are no resource atoms
 * yet (the tables landed with this feature), so the records below are declared
 * here and are deliberately NARROWER than the API rows: the fields an
 * orchestrator needs to reason about bookability, and nothing else. When the
 * generator grows resource atoms these should be replaced by them.
 */

// ============================================================================
// DATA
// ============================================================================

/** Minutes from midnight. `from` is always before `to`. */
export interface ResourceOpenInterval {
  from: number;
  to: number;
}

/**
 * Weekly availability, keyed by day-of-week as a string ('0' = Sunday … '6').
 * JSON object keys are always strings, which is what the column stores.
 */
export type ResourceWeeklyHours = Record<string, ResourceOpenInterval>;

/** A category as the write endpoints return it. */
export interface ResourceCategoryRecord {
  categoryId: string;
  name: string;
  /** Drives UI copy and defaults only; scheduling treats every kind alike. */
  kind: ResourceCategoryKind;
  description: string | null;
  isActive: boolean;
}

/** A resource as the write endpoints return it. */
export interface ResourceRecord {
  resourceId: string;
  categoryId: string;
  name: string;
  isActive: boolean;
  /** How many appointments may occupy it at once. */
  capacity: number;
  /**
   * `null` means ALWAYS AVAILABLE — it inherits the clinic's opening hours.
   * It does NOT mean "never available", and reading it that way is the single
   * most expensive mistake available in this domain.
   */
  workingHours: ResourceWeeklyHours | null;
  /** `null` means usable at every location. */
  locationId: string | null;
}

/**
 * A resource that can actually hold a booking.
 *
 * The narrowing is the point, as with `SyncedLeadForm`: this type cannot be
 * built for a deactivated resource, nor for one whose schedule names no open
 * day — `opensOn` is either the explicit `null` that means always-open, or a
 * NON-EMPTY tuple of day numbers. "Allocatable, open on no day" has no shape.
 */
export interface AllocatableResource extends Omit<ResourceRecord, 'isActive'> {
  isActive: true;
  /** `null` = always available. Otherwise the days it is open, 0 = Sunday. */
  opensOn: null | [number, ...number[]];
}

/**
 * Why a saved resource still cannot hold a booking. Both are ordinary,
 * deliberate states — neither is an error, which is exactly why they need
 * their own member rather than a silent success.
 */
export type ResourceUnallocatableReason =
  /** Saved with `isActive: false`. Holds nothing until it is switched back on. */
  | { kind: 'deactivated' }
  /**
   * A working-hours record exists and every day in it is closed. Note this is
   * NOT the same as having no record at all, which means always-available.
   */
  | { kind: 'no_open_days' };

// ============================================================================
// CATEGORIES
// ============================================================================

export interface CreateResourceCategoryRequest {
  name: string;
  /** Defaults to `room` server-side when omitted. */
  kind?: ResourceCategoryKind;
  description?: string | null;
}

export interface UpdateResourceCategoryRequest {
  categoryId: string;
  name?: string;
  kind?: ResourceCategoryKind;
  /** `undefined` leaves it untouched; `null` clears it. */
  description?: string | null;
  isActive?: boolean;
}

/** Why a category could not be created or updated. Nothing was written. */
export type CategoryWriteBlockedReason =
  /** Category names are unique per org (a soft-deleted one frees its name). */
  | { kind: 'duplicate_name'; name: string }
  | { kind: 'category_not_found'; categoryId: string }
  | { kind: 'invalid_input'; message: string }
  /** A stated refusal this union does not name yet; message carried verbatim. */
  | { kind: 'other'; message: string }
  /** The server faulted. Not a refusal — worth alerting on. */
  | { kind: 'server_error'; message: string };

export type CategoryWriteResult =
  | { status: 'saved'; category: ResourceCategoryRecord }
  | { status: 'not_saved'; reason: CategoryWriteBlockedReason };

/**
 * Why a category was not deleted.
 *
 * `category_not_empty` carries the server's own sentence rather than a count.
 * The count exists in that sentence, but the API surfaces the refusal as a
 * message and nothing else, so a numeric field here could only be recovered by
 * regex — a number that silently becomes wrong the day someone rewords the
 * message is worse than no number.
 */
export type CategoryDeleteBlockedReason =
  | { kind: 'category_not_empty'; message: string }
  | { kind: 'category_not_found'; categoryId: string }
  | { kind: 'other'; message: string }
  | { kind: 'server_error'; message: string };

export type CategoryDeleteResult =
  | { status: 'deleted'; categoryId: string }
  | { status: 'not_deleted'; reason: CategoryDeleteBlockedReason };

// ============================================================================
// RESOURCES
// ============================================================================

/**
 * Deliberately narrower than `POST /resources`.
 *
 * `color`, `photo`, `specs` and `sortOrder` are presentation, and an
 * orchestrator choosing a room's photo is reach nobody asked for. Ordering has
 * its own method. Everything that decides whether the room can be BOOKED is
 * here, which is the capability being claimed.
 */
export interface CreateResourceRequest {
  categoryId: string;
  name: string;
  description?: string | null;
  /** Concurrent appointments this resource can hold. Defaults to 1. */
  capacity?: number;
  /** Omit or `null` for always-available. */
  workingHours?: ResourceWeeklyHours | null;
  /** Omit or `null` for "available at every location". */
  locationId?: string | null;
}

export interface UpdateResourceRequest {
  resourceId: string;
  categoryId?: string;
  name?: string;
  description?: string | null;
  capacity?: number;
  /** `undefined` leaves the schedule alone; `null` makes it always-available. */
  workingHours?: ResourceWeeklyHours | null;
  locationId?: string | null;
  isActive?: boolean;
}

/** Why a resource could not be created or updated. Nothing was written. */
export type ResourceWriteBlockedReason =
  | { kind: 'category_not_found'; categoryId: string }
  | { kind: 'location_not_found'; locationId: string }
  | { kind: 'resource_not_found'; resourceId: string }
  | { kind: 'invalid_input'; message: string }
  | { kind: 'other'; message: string }
  | { kind: 'server_error'; message: string };

/**
 * Write outcome.
 *
 * Note what is absent: no `saved` boolean, and no member that reports a
 * bookable room without an `AllocatableResource` to prove it.
 */
export type ResourceWriteResult =
  /** Written AND able to hold a booking. The only state that may be called ready. */
  | { status: 'saved'; resource: AllocatableResource }
  /**
   * Written, and confirmed unable to hold a booking. The row is correct and
   * editable; any service requiring its category is short one resource until
   * this is addressed.
   */
  | {
      status: 'saved_unallocatable';
      resource: ResourceRecord;
      reason: ResourceUnallocatableReason;
    }
  /** Nothing was written. There is no resource to speak about. */
  | { status: 'not_saved'; reason: ResourceWriteBlockedReason };

/**
 * Why a resource was not deleted. `has_upcoming_bookings` carries the server's
 * sentence for the same reason `category_not_empty` does; the fix it names
 * (deactivate instead) is `updateResource` with `isActive: false`.
 */
export type ResourceDeleteBlockedReason =
  | { kind: 'has_upcoming_bookings'; message: string }
  | { kind: 'resource_not_found'; resourceId: string }
  | { kind: 'other'; message: string }
  | { kind: 'server_error'; message: string };

export type ResourceDeleteResult =
  | { status: 'deleted'; resourceId: string }
  | { status: 'not_deleted'; reason: ResourceDeleteBlockedReason };

export interface ReorderResourcesRequest {
  /** Each resource at most once; the server rejects a repeat. */
  order: Array<{ resourceId: string; sortOrder: number }>;
}

export type ReorderBlockedReason =
  | { kind: 'unknown_resource'; message: string }
  | { kind: 'invalid_input'; message: string }
  | { kind: 'other'; message: string }
  | { kind: 'server_error'; message: string };

export type ReorderResourcesResult =
  /** `resourceIds` echoes the order actually sent, so a caller cannot misreport it. */
  | { status: 'reordered'; resourceIds: string[] }
  | { status: 'not_reordered'; reason: ReorderBlockedReason };

// ============================================================================
// PER-SERVICE REQUIREMENTS — the surface that can make a service unbookable
// ============================================================================

export interface ServiceResourceRule {
  categoryId: string;
  /**
   * EMPTY means "any resource in this category" — the org-wide-by-default
   * convention scheduling uses throughout. Sending an empty array is NOT the
   * same as omitting the rule: omitting it removes the requirement entirely.
   */
  eligibleResourceIds: string[];
}

export interface SetServiceRequirementsRequest {
  serviceId: string;
  /** `undefined` leaves the service's turnaround untouched; `null` clears it. */
  turnaroundMinutes?: number | null;
  /** The COMPLETE set. Anything not listed is removed. */
  requirements: ServiceResourceRule[];
}

/** Why a rule cannot be met by anything the clinic currently owns. */
export type RequirementUnsatisfiableReason =
  /** The category holds no allocatable resource at all. */
  | { kind: 'category_empty' }
  /**
   * The rule names specific resources and none of them can currently hold a
   * booking (deactivated, or open on no day).
   */
  | { kind: 'named_resources_unallocatable'; resourceIds: string[] };

/**
 * One applied rule, CHECKED against the live resource list.
 *
 * A discriminated pair rather than `satisfiable: boolean`, so the reason a
 * rule fails cannot be dropped and a satisfiable rule cannot be reported
 * without the resources that satisfy it.
 */
export type RequirementCheck =
  | {
      kind: 'satisfiable';
      categoryId: string;
      categoryName: string;
      /** Non-empty by construction — this is what "satisfiable" means. */
      allocatableResourceIds: [string, ...string[]];
    }
  | {
      kind: 'unsatisfiable';
      categoryId: string;
      categoryName: string;
      reason: RequirementUnsatisfiableReason;
    };

/** Why the rule set was not written. The service is exactly as it was. */
export type RequirementsBlockedReason =
  | { kind: 'service_not_found'; serviceId: string }
  /** A named category or eligible resource does not belong where it was claimed. */
  | { kind: 'invalid_selection'; message: string }
  | { kind: 'invalid_input'; message: string }
  | { kind: 'other'; message: string }
  | { kind: 'server_error'; message: string };

/**
 * Requirement-write outcome.
 *
 * `applied` and `applied_unverified` both mean the rules ARE SAVED. They differ
 * in what may be said afterwards, and that is the whole reason they are
 * separate: in `applied`, every rule was checked, so an empty `unsatisfiable`
 * set is evidence the service can still be booked. In `applied_unverified`
 * nothing was checked, so the same silence is evidence of nothing.
 */
export type SetServiceRequirementsResult =
  | {
      status: 'applied';
      serviceId: string;
      turnaroundMinutes: number | null;
      /** One entry per applied rule, in the order sent. */
      checks: RequirementCheck[];
    }
  | {
      status: 'applied_unverified';
      serviceId: string;
      turnaroundMinutes: number | null;
      requirements: ServiceResourceRule[];
      /** Why the satisfiability check could not run. */
      message: string;
    }
  | { status: 'not_applied'; reason: RequirementsBlockedReason };

/**
 * Set which resource an EXISTING appointment holds in one category.
 *
 * `resourceId: null` means unassign — release the hold entirely. It is a
 * distinct instruction from "pick a different room", and collapsing the two
 * would leave an orchestrator unable to say the thing a front desk says most:
 * "take her out of Room 2, I'll sort it later."
 */
export interface SetAppointmentResourceRequest {
  appointmentId: string;
  /** The requirement slot being set — an appointment holds one per category. */
  categoryId: string;
  /** The resource to hold, or `null` to release the category's hold. */
  resourceId: string | null;
  /**
   * Knowingly hold a resource that is already taken.
   *
   * Off by default and it must stay that way: an orchestrator that forces by
   * habit turns every clash into a silent double-booking. Set it only when a
   * human has been told what the clash is and said yes anyway.
   */
  force?: boolean;
}

/**
 * Outcome of setting an appointment's resource.
 *
 * `released` is its own status rather than `assigned` with a null resource,
 * so a caller cannot read "it worked" and go on to describe a room that is no
 * longer held.
 */
export type SetAppointmentResourceResult =
  | {
      status: 'assigned';
      resourceId: string;
      resourceName: string;
      /** ISO. The hold, INCLUDING any turnaround tail — not the appointment. */
      heldFrom: string;
      heldUntil: string;
      /** True when the hold knowingly overlaps another. */
      overlapping: boolean;
    }
  | { status: 'released'; categoryId: string }
  | {
      /** The resource is already taken for that window. Retry with `force`. */
      status: 'taken';
      message: string;
    }
  | { status: 'not_applied'; reason: ResourceWriteBlockedReason };

// ============================================================================
// THE PORT
// ============================================================================

/**
 * Rooms & equipment as an orchestrator (Claire) may use them.
 *
 * Every mutating endpoint on `/resources` is here, because every one of them
 * can be the difference between a bookable service and an unbookable one. The
 * READS are deliberately absent: `listResources`, the utilisation report and
 * the allocation feed are honest as they stand and belong to Gate 6's tool
 * surface, not to a capability contract about repair.
 */
export interface ResourcesPort {
  /** Create a grouping ("Rooms", "Lasers") that services can require from. */
  createCategory(
    req: CreateResourceCategoryRequest
  ): Promise<CategoryWriteResult>;
  /** Rename, re-kind, or deactivate a category. */
  updateCategory(
    req: UpdateResourceCategoryRequest
  ): Promise<CategoryWriteResult>;
  /** Soft-delete a category. Refused while it still holds resources. */
  deleteCategory(categoryId: string): Promise<CategoryDeleteResult>;
  /** Add a room or device, and report whether it can actually be booked. */
  createResource(req: CreateResourceRequest): Promise<ResourceWriteResult>;
  /**
   * Edit a room or device — including the two fields that decide bookability,
   * `isActive` and `workingHours`. This is the method that repairs the
   * unbookable-service case.
   */
  updateResource(req: UpdateResourceRequest): Promise<ResourceWriteResult>;
  /** Soft-delete a resource. Refused while it holds future allocations. */
  deleteResource(resourceId: string): Promise<ResourceDeleteResult>;
  /** Set display order. Presentation only; never affects bookability. */
  reorderResources(
    req: ReorderResourcesRequest
  ): Promise<ReorderResourcesResult>;
  /**
   * Replace a service's ENTIRE resource rule set, and check each rule against
   * the resources the clinic actually has before reporting success.
   */
  setServiceRequirements(
    req: SetServiceRequirementsRequest
  ): Promise<SetServiceRequirementsResult>;
  /**
   * Move, assign or release the resource an existing appointment holds in one
   * category — the write behind the calendar's drag-to-reassign, the booking
   * dropdown and "which of today's bookings still needs a room".
   *
   * Deliberately cannot reschedule. It changes WHICH resource is held, never
   * when: rescheduling notifies the client and belongs to the appointments
   * capability, and an orchestrator that could move a booking in time as a
   * side effect of tidying rooms would be a hazard.
   */
  setAppointmentResource(
    req: SetAppointmentResourceRequest
  ): Promise<SetAppointmentResourceResult>;
}
