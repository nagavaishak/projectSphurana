import {
  organizationService,
  resource,
  resourceCategory,
  serviceResourceEligibility,
  serviceResourceRequirement,
} from '@borradh-workspace/database';
import { and, eq, inArray } from 'drizzle-orm';
import { type DbConnection, notDeleted } from '../../../shared/index.js';
import {
  type ResolvedResourceAvailability,
  resolveResourceAvailability,
} from './resolve-resource-availability.service.js';

export interface ResourceRequirementSpec {
  serviceId: string;
  categoryId: string;
  /** EMPTY ARRAY = every active resource in the category qualifies. */
  eligibleResourceIds: string[];
}

export interface ResourceGateContext {
  /** categoryId -> ids of active, non-deleted resources (location-filtered if given), sorted by sortOrder then id. */
  resourcesByCategory: Map<string, string[]>;
  availabilityByResource: Map<string, ResolvedResourceAvailability>;
  requirements: ResourceRequirementSpec[];
  /** Max turnaround across the cart's services; the hold extends this far past slot end. */
  turnaroundMinutes: number;
}

/** One category the cart must satisfy, with the candidates that may satisfy it. */
interface CategoryDemand {
  categoryId: string;
  /** Candidate resource ids, in `resourcesByCategory` order. */
  candidates: string[];
}

/**
 * Collapse the cart's requirement rows into ONE demand per category.
 *
 * v1 books a single hold per required category spanning the whole appointment
 * (per-line sequential holds is a marked follow-up, exactly as per-line
 * practitioners already are). So two services that both need a Room share one
 * room — which means that room must satisfy BOTH services' eligibility, hence
 * the intersection below.
 *
 * A requirement with ZERO eligibility rows means "any resource in the category"
 * and therefore narrows nothing. This is the same org-wide-by-default
 * convention `blocked_time` uses for its practitioner joins, and inverting it is
 * the single most destructive mistake available here: treating zero rows as
 * "nothing qualifies" makes every gated slot unbookable for every org that
 * never restricted a service to specific rooms — i.e. almost all of them.
 */
function categoryDemands(ctx: ResourceGateContext): CategoryDemand[] {
  // null = "not narrowed yet" (distinct from an empty set, which means the
  // services' eligibility lists have no resource in common ⇒ unsatisfiable).
  const narrowedByCategory = new Map<string, Set<string> | null>();

  for (const requirement of ctx.requirements) {
    const current = narrowedByCategory.get(requirement.categoryId) ?? null;
    if (requirement.eligibleResourceIds.length === 0) {
      // Zero rows = all eligible: record the category, narrow nothing.
      if (!narrowedByCategory.has(requirement.categoryId)) {
        narrowedByCategory.set(requirement.categoryId, null);
      }
      continue;
    }
    if (current === null) {
      narrowedByCategory.set(
        requirement.categoryId,
        new Set(requirement.eligibleResourceIds)
      );
      continue;
    }
    const allowed = new Set(requirement.eligibleResourceIds);
    narrowedByCategory.set(
      requirement.categoryId,
      new Set([...current].filter((id) => allowed.has(id)))
    );
  }

  const demands: CategoryDemand[] = [];
  for (const [categoryId, narrowed] of narrowedByCategory) {
    const all = ctx.resourcesByCategory.get(categoryId) ?? [];
    demands.push({
      categoryId,
      candidates:
        narrowed === null ? all : all.filter((id) => narrowed.has(id)),
    });
  }
  return demands;
}

/** UTC instant the hold ends: the slot plus the cart's cleanup tail. */
function holdEndFor(ctx: ResourceGateContext, slotEnd: Date): Date {
  return new Date(slotEnd.getTime() + ctx.turnaroundMinutes * 60_000);
}

/**
 * Is this resource free for [start, end)?
 *
 * Two independent conditions:
 *  - Capacity: the number of allocations OVERLAPPING the range must be under
 *    capacity. Capacity > 1 models a double treatment room / a 4-station nail
 *    bar; a plain exclusion constraint cannot count to N, so this in-memory
 *    count is the enforcement point.
 *  - Containment: the range must fit inside ONE working interval. Turnaround is
 *    part of the range, so a room whose day ends at 17:00 cannot take a 16:45
 *    slot that needs 20 minutes of cleanup.
 *
 * Overlap is half-open (`start < b.end && end > b.start`) so back-to-back
 * ranges do not collide — the same test `generateSlots` uses for practitioners.
 */
function isResourceFree(
  availability: ResolvedResourceAvailability,
  start: Date,
  end: Date
): boolean {
  let overlapping = 0;
  for (const busy of availability.busy) {
    if (start < busy.end && end > busy.start) overlapping++;
  }
  if (overlapping >= availability.capacity) return false;
  return availability.working.some((w) => w.start <= start && w.end >= end);
}

/** Candidates that are free for the whole hold, in `resourcesByCategory` order. */
function freeCandidates(
  ctx: ResourceGateContext,
  demand: CategoryDemand,
  slotStart: Date,
  holdEnd: Date
): string[] {
  const free: string[] = [];
  for (const resourceId of demand.candidates) {
    const availability = ctx.availabilityByResource.get(resourceId);
    // No availability entry = the resource was deactivated or soft-deleted
    // between the requirement being written and now. Absent ⇒ not bookable.
    if (!availability) continue;
    if (isResourceFree(availability, slotStart, holdEnd)) free.push(resourceId);
  }
  return free;
}

/**
 * Can every required category be satisfied for this slot?
 *
 * The hold runs [slotStart, slotEnd + turnaround) — turnaround extends the HOLD,
 * never the appointment, which is why `appointment_resource` carries its own
 * dates rather than reading the appointment's.
 */
export function hasFreeResourcesFor(
  ctx: ResourceGateContext,
  slotStart: Date,
  slotEnd: Date
): boolean {
  if (ctx.requirements.length === 0) return true;
  const holdEnd = holdEndFor(ctx, slotEnd);
  for (const demand of categoryDemands(ctx)) {
    if (freeCandidates(ctx, demand, slotStart, holdEnd).length === 0) {
      return false;
    }
  }
  return true;
}

/**
 * Drop the slots that no free resource can serve.
 *
 * Cost is the same shape as the existing busy-overlap check in `generateSlots`:
 * allocations are fetched once per request and every per-slot test is an
 * in-memory overlap count.
 */
export function filterSlotsByResources<T extends { start: Date; end: Date }>(
  slots: T[],
  ctx: ResourceGateContext
): T[] {
  if (ctx.requirements.length === 0) return slots;
  const demands = categoryDemands(ctx);
  return slots.filter((slot) => {
    const holdEnd = holdEndFor(ctx, slot.end);
    return demands.every(
      (demand) => freeCandidates(ctx, demand, slot.start, holdEnd).length > 0
    );
  });
}

/**
 * Choose one resource per required category for a concrete booking.
 * Returns null when some required category has NOTHING free.
 * Selection: among free eligible resources prefer the LEAST-ALLOCATED that calendar day
 * (fewest busy ranges overlapping that day) so wear spreads across rooms; ties break on
 * the order in resourcesByCategory.
 *
 * The day bucket is the UTC day containing `slotStart`, not the org's zoned day.
 * This is a wear-spreading heuristic, not a correctness rule: any consistent
 * bucket spreads load, and carrying a time zone into this context purely to
 * shift a tie-break by a few hours would not change which rooms are bookable.
 *
 * Categories never share resources (a resource has exactly one categoryId), so
 * picks across categories cannot collide.
 */
export function pickResourcesFor(
  ctx: ResourceGateContext,
  slotStart: Date,
  slotEnd: Date
): Array<{
  categoryId: string;
  resourceId: string;
  turnaroundMinutes: number;
}> | null {
  const holdEnd = holdEndFor(ctx, slotEnd);
  const dayStart = Date.UTC(
    slotStart.getUTCFullYear(),
    slotStart.getUTCMonth(),
    slotStart.getUTCDate()
  );
  const dayEnd = dayStart + 24 * 60 * 60_000;

  const picks: Array<{
    categoryId: string;
    resourceId: string;
    turnaroundMinutes: number;
  }> = [];

  for (const demand of categoryDemands(ctx)) {
    const free = freeCandidates(ctx, demand, slotStart, holdEnd);
    if (free.length === 0) return null;

    let best = free[0];
    let bestLoad = Number.POSITIVE_INFINITY;
    for (const resourceId of free) {
      const availability = ctx.availabilityByResource.get(resourceId);
      let load = 0;
      for (const busy of availability?.busy ?? []) {
        if (busy.start.getTime() < dayEnd && busy.end.getTime() > dayStart) {
          load++;
        }
      }
      // Strict `<` keeps the first (i.e. resourcesByCategory-ordered) winner on
      // a tie, so allocation is deterministic for a given state.
      if (load < bestLoad) {
        best = resourceId;
        bestLoad = load;
      }
    }

    picks.push({
      categoryId: demand.categoryId,
      resourceId: best,
      // The hold spans the whole cart, so every category carries the cart's max
      // turnaround — not the per-service value.
      turnaroundMinutes: ctx.turnaroundMinutes,
    });
  }

  return picks;
}

/**
 * MUST return null when no service in `serviceIds` has ANY requirement row — the
 * zero-cost rollout-safety path; callers skip all resource logic on null.
 *
 * That early return is what makes this feature invisible to every org that never
 * sets a room up: one indexed lookup that finds nothing, then the booking path
 * behaves exactly as it did before resources existed.
 *
 * Expects to run inside an org scope (withOrgScope / withPublicOrgScope).
 */
export async function loadResourceGateContext(
  db: DbConnection,
  input: {
    organizationId: string;
    serviceIds: string[];
    from: Date;
    to: Date;
    timeZone: string;
    locationId?: string | null;
    excludeAppointmentIds?: string[];
  }
): Promise<ResourceGateContext | null> {
  const {
    organizationId,
    serviceIds,
    from,
    to,
    timeZone,
    locationId,
    excludeAppointmentIds,
  } = input;

  if (serviceIds.length === 0) return null;

  // ── Requirements (the rollout-safety gate) ────────────────────────────────
  const requirementRows = await db
    .select({
      serviceId: serviceResourceRequirement.serviceId,
      categoryId: serviceResourceRequirement.categoryId,
    })
    .from(serviceResourceRequirement)
    .where(
      and(
        eq(serviceResourceRequirement.organizationId, organizationId),
        inArray(serviceResourceRequirement.serviceId, serviceIds)
      )
    );

  if (requirementRows.length === 0) return null;

  // ── Eligibility ───────────────────────────────────────────────────────────
  // Rows are (service, resource); the resource's own categoryId decides which
  // requirement each row narrows.
  const eligibilityRows = await db
    .select({
      serviceId: serviceResourceEligibility.serviceId,
      resourceId: serviceResourceEligibility.resourceId,
    })
    .from(serviceResourceEligibility)
    .where(
      and(
        eq(serviceResourceEligibility.organizationId, organizationId),
        inArray(serviceResourceEligibility.serviceId, serviceIds)
      )
    );

  // ── Categories ────────────────────────────────────────────────────────────
  // A requirement pointing at a soft-deleted or deactivated category is dropped
  // rather than honoured. Honouring it would make every service still bound to
  // that category permanently unbookable — deleting a category must degrade to
  // "no longer gated", never to "no longer sellable".
  const requiredCategoryIds = [
    ...new Set(requirementRows.map((row) => row.categoryId)),
  ];
  const categoryRows = await db
    .select({ id: resourceCategory.id })
    .from(resourceCategory)
    .where(
      and(
        eq(resourceCategory.organizationId, organizationId),
        inArray(resourceCategory.id, requiredCategoryIds),
        eq(resourceCategory.isActive, true),
        notDeleted(resourceCategory)
      )
    );
  const liveCategoryIds = new Set(categoryRows.map((row) => row.id));

  const requirements: ResourceRequirementSpec[] = [];
  for (const row of requirementRows) {
    if (!liveCategoryIds.has(row.categoryId)) continue;
    requirements.push({
      serviceId: row.serviceId,
      categoryId: row.categoryId,
      // Filled in below, once resource → category is known.
      eligibleResourceIds: [],
    });
  }
  if (requirements.length === 0) return null;

  // ── Resources in the required categories ──────────────────────────────────
  // Explicit column list, NOT select(*) — `app_public` (the unauthenticated
  // booking widget) is granted only id / organization_id / category_id /
  // location_id / capacity / working_hours / sort_order / is_active /
  // deleted_at on this table (migration 0148). `sort_order` IS granted, so
  // ordering by it is safe; `name` is NOT, and must never be reintroduced as a
  // tie-break — that grant governs ORDER BY too (Postgres checks column
  // privileges on EVERY referenced column, selected or not), and an ungranted
  // one raises "permission denied", which the booking service swallows into an
  // EMPTY-SLOTS result, i.e. gating silently switches off.
  // Fetched ORG-WIDE and partitioned in memory rather than filtered in SQL.
  // The branch subset is what gates; the full set answers the separate question
  // "does this category have a resource ANYWHERE" — which distinguishes a
  // branch gap (degrade to ungated) from an org-wide configuration mistake
  // (keep gating, so the console warns). One query, not two.
  const allResourceRows = await db
    .select({
      id: resource.id,
      categoryId: resource.categoryId,
      sortOrder: resource.sortOrder,
      locationId: resource.locationId,
    })
    .from(resource)
    .where(
      and(
        eq(resource.organizationId, organizationId),
        inArray(resource.categoryId, [...liveCategoryIds]),
        eq(resource.isActive, true),
        notDeleted(resource)
      )
    );

  const orgWideCategoryIds = new Set(
    allResourceRows.map((row) => row.categoryId)
  );

  // A null-location resource (a trolley-mounted device) is available
  // everywhere, mirroring how null-location shift rows always apply.
  const resourceRows = locationId
    ? allResourceRows.filter(
        (row) => row.locationId === null || row.locationId === locationId
      )
    : allResourceRows;

  // Clinic-chosen order first, then id as the stable final tie-break, so a
  // given clinic state always allocates the same room. Sorted in memory purely
  // to keep the query flat — both columns are readable to `app_public`, so an
  // ORDER BY would be equally valid.
  resourceRows.sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
  );

  const categoryByResource = new Map(
    resourceRows.map((row) => [row.id, row.categoryId])
  );
  const resourcesByCategory = new Map<string, string[]>();
  for (const row of resourceRows) {
    const list = resourcesByCategory.get(row.categoryId) ?? [];
    list.push(row.id);
    resourcesByCategory.set(row.categoryId, list);
  }

  // Attach eligibility to the requirement it narrows: an eligibility row only
  // constrains the (service, category) pair its resource belongs to. Rows
  // pointing at a resource that no longer exists are ignored, which correctly
  // widens back to "any resource in the category" once the last named resource
  // is deleted rather than making the service unbookable.
  for (const row of eligibilityRows) {
    const categoryId = categoryByResource.get(row.resourceId);
    if (!categoryId) continue;
    for (const requirement of requirements) {
      if (
        requirement.serviceId === row.serviceId &&
        requirement.categoryId === categoryId
      ) {
        requirement.eligibleResourceIds.push(row.resourceId);
      }
    }
  }

  // ── Categories with nothing to offer AT THIS BRANCH ───────────────────────
  // A requirement whose category has no resource at the branch being asked
  // about — but does have one SOMEWHERE in the org — is dropped, exactly as a
  // soft-deleted category is above.
  //
  // The case this fixes is silent. Requirements are org-wide; resources are
  // branch-filtered. So a branch that SELLS a service but has no room in its
  // required category produced one demand with zero candidates —
  // `freeCandidates` returns empty, every slot is dropped, and the service is
  // unbookable at that branch with no error anywhere. The symptom is an empty
  // calendar, which reads as "nothing configured yet".
  //
  // Gating degrades to UNGATED, never to unsellable — the rule the
  // soft-deleted-category case already states, and the same instinct behind
  // "zero eligibility rows means every resource qualifies". It is also why
  // per-branch `service_resource_requirement` rows are not needed: a branch
  // that should not run a service at all says so by not OFFERING it
  // (`organization_service_location`); a branch that sells it without a room
  // is now simply ungated.
  //
  // ⚠️ SCOPED TO THE BRANCH GAP, DELIBERATELY. A category that is empty
  // ORG-WIDE is a different statement: the clinic configured a requirement and
  // owns no such resource anywhere, which is a configuration mistake it should
  // hear about. That path still produces a demand with no candidates, so a
  // console booking is WARNED ("no room for this appointment") rather than
  // silently ungated — see `resource-assignment-modes.int-spec.ts`, "CONSOLE
  // with a required category that has no resources at all". Dropping both
  // cases together turns that warning off, which is how this first shipped and
  // what the suite caught.
  if (locationId) {
    const emptyHereButNotOrgWide = new Set(
      [...liveCategoryIds].filter(
        (categoryId) =>
          (resourcesByCategory.get(categoryId)?.length ?? 0) === 0 &&
          orgWideCategoryIds.has(categoryId)
      )
    );
    if (emptyHereButNotOrgWide.size > 0) {
      const kept = requirements.filter(
        (requirement) => !emptyHereButNotOrgWide.has(requirement.categoryId)
      );
      if (kept.length === 0) return null;
      requirements.length = 0;
      requirements.push(...kept);
    }
  }

  // ── Turnaround ────────────────────────────────────────────────────────────
  // v1 books ONE hold spanning the cart, so the tail is the max across the
  // cart's services, not a per-line value.
  const serviceRows = await db
    .select({
      id: organizationService.id,
      turnaroundMinutes: organizationService.turnaroundMinutes,
    })
    .from(organizationService)
    .where(
      and(
        eq(organizationService.organizationId, organizationId),
        inArray(organizationService.id, serviceIds)
      )
    );
  const turnaroundMinutes = serviceRows.reduce(
    (max, row) => Math.max(max, row.turnaroundMinutes ?? 0),
    0
  );

  // The availability window is padded by the turnaround so a slot at the very
  // end of the requested window can still fit its cleanup tail. Without this,
  // an always-open resource (working = [from, to]) would reject the last slot
  // of every window for a reason that has nothing to do with the schedule.
  const availability = await resolveResourceAvailability(db, {
    organizationId,
    resourceIds: resourceRows.map((row) => row.id),
    from,
    to: new Date(to.getTime() + turnaroundMinutes * 60_000),
    timeZone,
    excludeAppointmentIds,
  });

  return {
    resourcesByCategory,
    availabilityByResource: new Map(
      availability.map((entry) => [entry.resourceId, entry])
    ),
    requirements,
    turnaroundMinutes,
  };
}
