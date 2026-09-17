import type {
  AppointmentResourceAllocation,
  Resource,
  ResourceAssignmentMode,
  ResourceCategory,
  ResourceCategoryKind,
  ServiceResourceRequirementView,
} from '@borradh-workspace/api-client/types';
import { resourceCategoryKindSingularLabels } from '@borradh-workspace/api-client/types';
import { useMemo } from 'react';

import { useGetOrgDefaults } from '@/features/org-defaults';
import { useListResourceCategories } from '@/features/resources';

/**
 * PROGRESSIVE DISCLOSURE — the single gate every resource affordance sits
 * behind.
 *
 * Rooms & equipment is a brand-new capability and EVERY existing clinic has
 * zero resource categories. For them the booking surfaces must look
 * byte-identical to what they looked like yesterday: no chip, no row, no
 * "Needs room" pill, no extra whitespace. That is a hard requirement on a
 * surface the whole business books through, so the condition lives HERE, in
 * one place, rather than as five `categories.length > 0` checks scattered
 * across the dialog, the mobile funnel, the side panel and the toast.
 *
 * "Has resources" means at least one ACTIVE category that actually contains a
 * resource. A category created but never filled is not a usable configuration
 * — surfacing an empty picker for it would be worse than surfacing nothing.
 */

/**
 * Stable empty fallback. An inline `?? []` mints a new array per render and
 * breaks referential equality for the memos below — the same trap the
 * `NO_CATEGORIES` note in `features/resources` calls out.
 */
const NO_CATEGORIES: ResourceCategory[] = [];

/**
 * Defensive normalisation.
 *
 * The list hooks are typed as arrays, but this gate now runs inside the
 * highest-traffic booking surfaces in the app — surfaces whose existing specs
 * stub `apiClient.get` with a catch-all that answers every unrecognised URL
 * with `{ items: [], total: 0 }`. A bare `.filter()` on that object throws and
 * takes the whole dialog down. Normalising costs nothing and means a
 * mis-shaped response degrades to "no resources configured", which is exactly
 * the pre-existing behaviour.
 */
const asArray = <T,>(value: T[] | undefined | null): T[] =>
  Array.isArray(value) ? value : (NO_CATEGORIES as unknown as T[]);

export interface ResourceScheduling {
  /**
   * THE gate. False for every org that has not configured rooms/equipment —
   * render nothing resource-related when this is false.
   */
  enabled: boolean;
  /** Active categories that hold at least one resource. */
  categories: ResourceCategory[];
  /** `auto` (default) or `manual`. */
  mode: ResourceAssignmentMode;
  /**
   * Manual mode: a console booking creates NO allocation, so an appointment
   * legitimately sits there needing a room. Online bookings are auto-assigned
   * regardless — this flag never reaches a customer-facing surface.
   */
  isManual: boolean;
  isLoading: boolean;
}

/** Categories + assignment mode for the active org, behind one gate. */
export function useResourceScheduling(): ResourceScheduling {
  const { categories, isLoading: isLoadingCategories } =
    useListResourceCategories();
  const { defaults, isLoading: isLoadingDefaults } = useGetOrgDefaults();

  return useMemo(() => {
    const usable = asArray(categories).filter(
      (category) =>
        category.isActive !== false && (category.resourceCount ?? 0) > 0
    );
    const mode: ResourceAssignmentMode =
      defaults?.resourceAssignmentMode ?? 'auto';

    return {
      enabled: usable.length > 0,
      categories: usable,
      mode,
      isManual: mode === 'manual',
      isLoading: isLoadingCategories || isLoadingDefaults,
    };
  }, [categories, defaults, isLoadingCategories, isLoadingDefaults]);
}

/**
 * WARNING STYLING — amber, in one place.
 *
 * There is no `--warning` token in `styles.css`; the convention this codebase
 * already uses for a non-blocking warning is the amber ramp with a dark-mode
 * pair (see `features/timesheets/components/edit-time-entry-dialog.tsx` and
 * `features/assistant/_components/usage-banner.tsx`). Centralised here so the
 * chip, the pill and the popover option can never drift into three different
 * ambers — and so a real token, when one lands, is a one-line change.
 */
export const RESOURCE_WARNING_CLASSES =
  'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:border-amber-500/30 dark:text-amber-400';

/** Amber text only — for inline copy inside an already-bordered surface. */
export const RESOURCE_WARNING_TEXT_CLASSES =
  'text-amber-700 dark:text-amber-400';

/** "Room" / "Equipment" / "Resource" — the singular noun for inline copy. */
export const categoryNoun = (kind: ResourceCategoryKind | undefined): string =>
  resourceCategoryKindSingularLabels[kind ?? 'other'] ?? 'Resource';

/** Lowercased noun for mid-sentence copy ("No room is available…"). */
export const categoryNounLower = (
  kind: ResourceCategoryKind | undefined
): string => categoryNoun(kind).toLowerCase();

// ---------------------------------------------------------------------------
// Requirements → the categories a booking must fill
// ---------------------------------------------------------------------------

/** One category the chosen service(s) require, resolved for the picker. */
export interface RequiredResourceCategory {
  categoryId: string;
  categoryName: string;
  categoryKind: ResourceCategoryKind;
  /** EMPTY means "any resource in this category" — never "none". */
  eligibleResourceIds: string[];
}

/**
 * Fold a service's requirement rows against the org's usable categories.
 *
 * Two things are deliberately dropped: a requirement pointing at a category
 * that is inactive or empty (nothing to pick, so nothing to show), and a
 * duplicate category (a multi-service cart can require the same room twice;
 * the booking still needs exactly one chip for it).
 */
/**
 * Every category the booking can attach, whether or not the service demands it.
 *
 * Requirements decide what the SERVER will gate on; they should not decide what
 * the front desk is allowed to record. A clinic that puts a facial in Room 2
 * wants that on the calendar even though the service needs no room — and until
 * this existed the section simply never appeared for such a service, which is
 * why rooms looked broken for every pre-existing booking.
 *
 * Required categories keep their eligibility narrowing and sort first; the rest
 * are offered with every resource in them and marked optional.
 */
export function resolveSelectableCategories(
  requirements: ServiceResourceRequirementView[] | undefined,
  usableCategories: ResourceCategory[]
): SelectableResourceCategory[] {
  const required = resolveRequiredCategories(requirements, usableCategories);
  const requiredById = new Map(required.map((c) => [c.categoryId, c]));

  const optional = usableCategories
    .filter((category) => !requiredById.has(category.id))
    .map((category) => ({
      categoryId: category.id,
      categoryName: category.name,
      categoryKind: category.kind,
      // No requirement row means no narrowing: anything in the category goes.
      eligibleResourceIds: [] as string[],
      required: false,
    }));

  return [
    ...required.map((category) => ({ ...category, required: true })),
    ...optional,
  ];
}

export interface SelectableResourceCategory extends RequiredResourceCategory {
  /** True when the SERVICE demands this category — drives gating and copy. */
  required: boolean;
}

export function resolveRequiredCategories(
  requirements: ServiceResourceRequirementView[] | undefined,
  usableCategories: ResourceCategory[]
): RequiredResourceCategory[] {
  if (!Array.isArray(requirements) || requirements.length === 0) return [];

  const byId = new Map(usableCategories.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const resolved: RequiredResourceCategory[] = [];

  for (const requirement of requirements) {
    const category = byId.get(requirement.categoryId);
    if (!category || seen.has(requirement.categoryId)) continue;
    seen.add(requirement.categoryId);
    resolved.push({
      categoryId: requirement.categoryId,
      categoryName: requirement.categoryName || category.name,
      categoryKind: requirement.categoryKind ?? category.kind,
      eligibleResourceIds: Array.isArray(requirement.eligibleResourceIds)
        ? requirement.eligibleResourceIds
        : [],
    });
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Free / busy
// ---------------------------------------------------------------------------

/** Half-open overlap: touching ends do NOT clash. */
const overlaps = (
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean => aStart < bEnd && bStart < aEnd;

export interface BookingWindow {
  start: Date;
  end: Date;
}

/**
 * Resource ids already held across a booking window.
 *
 * `excludeAppointmentId` keeps an appointment from reporting ITSELF as the
 * thing blocking its own room — without it, every override popover opened
 * from the side panel would mark the currently-assigned room busy.
 *
 * Capacity is respected: a room that takes two at once is only busy on its
 * third hold.
 */
export function busyResourceIds(
  allocations: AppointmentResourceAllocation[] | undefined,
  window: BookingWindow | null,
  resources: Resource[],
  excludeAppointmentId?: string
): Set<string> {
  const busy = new Set<string>();
  if (!window) return busy;

  const start = window.start.getTime();
  const end = window.end.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return busy;

  const capacityOf = new Map(
    resources.map((resource) => [
      resource.id,
      Math.max(1, resource.capacity ?? 1),
    ])
  );
  const holds = new Map<string, number>();

  for (const allocation of asArray(allocations)) {
    if (
      excludeAppointmentId &&
      allocation.appointmentId === excludeAppointmentId
    ) {
      continue;
    }
    const holdStart = new Date(allocation.startDate).getTime();
    const holdEnd = new Date(allocation.endDate).getTime();
    if (!Number.isFinite(holdStart) || !Number.isFinite(holdEnd)) continue;
    if (!overlaps(start, end, holdStart, holdEnd)) continue;

    const next = (holds.get(allocation.resourceId) ?? 0) + 1;
    holds.set(allocation.resourceId, next);
    if (next >= (capacityOf.get(allocation.resourceId) ?? 1)) {
      busy.add(allocation.resourceId);
    }
  }

  return busy;
}

/**
 * The FIRST hold standing in the way of putting this booking in `resourceId`,
 * or null when there is room.
 *
 * `busyResourceIds` answers "is it free"; this answers "what is in it", which
 * is what an overbook warning has to say. "Room 2 is already booked" is a
 * refusal the operator cannot check; "Room 2 is booked 14:00–14:45" is
 * something they can look at the diary and agree or disagree with.
 *
 * Capacity is respected identically: a room that takes two at once only
 * reports a clash on the hold that would be the third.
 */
export function clashingHoldFor(
  allocations: AppointmentResourceAllocation[] | undefined,
  window: BookingWindow | null,
  resource: Resource | undefined,
  excludeAppointmentId?: string
): AppointmentResourceAllocation | null {
  if (!(window && resource)) return null;

  const start = window.start.getTime();
  const end = window.end.getTime();
  if (!(Number.isFinite(start) && Number.isFinite(end))) return null;

  const capacity = Math.max(1, resource.capacity ?? 1);
  const overlapping: AppointmentResourceAllocation[] = [];

  for (const allocation of asArray(allocations)) {
    if (allocation.resourceId !== resource.id) continue;
    if (
      excludeAppointmentId &&
      allocation.appointmentId === excludeAppointmentId
    ) {
      continue;
    }
    const holdStart = new Date(allocation.startDate).getTime();
    const holdEnd = new Date(allocation.endDate).getTime();
    if (!(Number.isFinite(holdStart) && Number.isFinite(holdEnd))) continue;
    if (!overlaps(start, end, holdStart, holdEnd)) continue;
    overlapping.push(allocation);
  }

  // Under capacity ⇒ there is a free seat ⇒ nothing is in the way.
  if (overlapping.length < capacity) return null;

  // The earliest overlapping hold reads most naturally as "the one that's
  // already in there".
  return overlapping.reduce((earliest, candidate) =>
    new Date(candidate.startDate) < new Date(earliest.startDate)
      ? candidate
      : earliest
  );
}

/**
 * The resources a category offers for this booking, in display order.
 *
 * An EMPTY `eligibleResourceIds` means "any resource in this category", which
 * is the org-wide-by-default convention throughout scheduling — treating it as
 * "none" would empty the picker for the most common configuration there is.
 */
export function eligibleResources(
  resources: Resource[] | undefined,
  categoryId: string,
  eligibleResourceIds: string[]
): Resource[] {
  const inCategory = asArray(resources).filter(
    (resource) =>
      resource.categoryId === categoryId && resource.isActive !== false
  );
  if (eligibleResourceIds.length === 0) return inCategory;
  const allowed = new Set(eligibleResourceIds);
  return inCategory.filter((resource) => allowed.has(resource.id));
}

/**
 * What the server's allocator will most likely pick: the first free eligible
 * resource, else the first eligible one.
 *
 * This is a PREVIEW, which is why the chip labels it `(auto)` rather than
 * presenting it as a decision already taken. Nothing is sent to the API for an
 * auto chip — only an explicit human override travels as `resourceIds`, so a
 * stale prediction can never talk the allocator into a room it would not have
 * chosen itself.
 */
export function predictAutoResource(
  candidates: Resource[],
  busy: Set<string>
): Resource | null {
  return candidates.find((r) => !busy.has(r.id)) ?? candidates[0] ?? null;
}
