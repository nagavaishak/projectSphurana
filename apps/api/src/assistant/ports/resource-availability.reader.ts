import type { AvailabilityBlocker } from '@borradh-workspace/contracts/ports';
import { db as defaultDb } from '@borradh-workspace/database';
import {
  type ResourceGateContext,
  loadResourceGateContext,
} from '@borradh-workspace/features/scheduling';
import {
  formatTimeInOrgZone,
  zonedWallTimeToUtc,
} from '@borradh-workspace/features/shared';
import { resourceCategoryKindSingularLabels } from '@borradh-workspace/labels';

/**
 * The FIFTH availability source: rooms, lasers and machines.
 *
 * Unlike the other four this does not come over `apiFetch`, and NOT for want of
 * routes — `GET /resources`, `/resources/categories` and
 * `/resources/requirements/:serviceId` all exist. They return the INPUTS to the
 * gating decision (which rooms, which categories, which rules), not the
 * decision. Composing "is this slot resourceable?" out of them would re-derive
 * eligibility narrowing, capacity counting and the turnaround tail here, in a
 * second place, from a different transport — and the day that copy drifts from
 * `loadResourceGateContext`, slots and diagnoses disagree and the owner is sent
 * to move an appointment that was never in the way.
 *
 * So the reader drives the engine that actually gates the bookings, and derives
 * the EXPLANATION from the same state. The read routes remain the right tool
 * for showing an owner their rooms; they are the wrong one for telling them why
 * a slot does not exist.
 *
 * Read-only throughout.
 */

type Db = typeof defaultDb;

/**
 * Derived off the blocker union rather than imported by name: `ResourceContention`
 * is declared in `availability.port.ts`, but the ports barrel does not re-export
 * it yet. This binds to the same declaration, so it cannot drift, and it becomes
 * a plain import the moment the barrel catches up.
 */
type ResourceContention = Extract<
  AvailabilityBlocker,
  { kind: 'no_free_resource' }
>['contention'][number];

export interface ResourceReadRequest {
  /** YYYY-MM-DD. */
  from: string;
  /** YYYY-MM-DD. */
  to: string;
  /** Every date in [from, to], as the adapter already enumerated them. */
  dates: readonly string[];
  /** Without one, what a booking NEEDS is unknowable — see `unread`. */
  serviceId?: string;
  locationId?: string;
}

/**
 * What the reader managed to learn.
 *
 * `not_applicable` and `unread` are deliberately different members, and
 * collapsing them in either direction is the whole risk in this file:
 *  - `unread` dressed as `not_applicable` re-creates the lie the port exists to
 *    prevent, one source further along.
 *  - `not_applicable` dressed as `unread` denies a complete answer to every
 *    clinic that has never configured a room — today, nearly all of them.
 */
export type ResourceReadResult =
  | { status: 'not_applicable' }
  | {
      status: 'checked';
      categories: { categoryId: string; name: string }[];
      blockers: AvailabilityBlocker[];
    }
  /** `fault` set ⇒ the server broke, which is alertable. Absent ⇒ the caller
   *  did not give us enough to ask the question at all. */
  | { status: 'unread'; fault?: string };

export type ResourceReader = (
  request: ResourceReadRequest
) => Promise<ResourceReadResult>;

export interface ResourceReaderDeps {
  organizationId: string;
  /** IANA zone (`organization.timezone`) — every window here is wall-clock. */
  timeZone: string;
  db?: Db;
}

interface Interval {
  start: number;
  end: number;
}

interface CategoryLabel {
  name: string;
  noun: string;
}

interface Candidate {
  resourceId: string;
  name: string;
  capacity: number;
  working: Interval[];
  busy: Interval[];
}

export function createResourceAvailabilityReader(
  deps: ResourceReaderDeps
): ResourceReader {
  const { organizationId, timeZone } = deps;
  const db = deps.db ?? defaultDb;

  return async (request) => {
    try {
      // The cheapest question first: does ANY service in this org require a
      // resource? "No" is a real answer, not a skipped check — and it is the
      // answer for every org that has never opened the rooms settings. Asking
      // it BEFORE `serviceId` matters is what keeps those orgs on the
      // complete-`read` path they were on before resources existed.
      // Relational-query form on purpose: `apps/api` does not depend on
      // `drizzle-orm` directly, and the operator callback keeps this one probe
      // from being the reason it starts to.
      const anyRequirement =
        await db.query.serviceResourceRequirement.findFirst({
          columns: { serviceId: true },
          where: (row, { eq }) => eq(row.organizationId, organizationId),
        });

      if (!anyRequirement) return { status: 'not_applicable' };

      // The org gates on resources somewhere, so "no service named" is a
      // genuine gap rather than a clean bill of health — the same treatment
      // opening hours get when no `locationId` is supplied.
      if (!request.serviceId) return { status: 'unread' };

      const ctx = await loadResourceGateContext(db, {
        organizationId,
        serviceIds: [request.serviceId],
        from: new Date(
          zonedDayStart(request.dates[0] ?? request.from, timeZone)
        ),
        to: new Date(
          zonedDayEnd(
            request.dates[request.dates.length - 1] ?? request.to,
            timeZone
          )
        ),
        timeZone,
        locationId: request.locationId ?? null,
      });

      // null = this service needs nothing. The engine's rollout-safety path,
      // and the reason a clinic that gated ONE service still gets a clean read
      // for all the others.
      if (!ctx) return { status: 'not_applicable' };

      const [labels, names] = await Promise.all([
        categoryLabels(db, organizationId),
        resourceNames(db, organizationId),
      ]);
      const demands = categoryDemands(ctx);

      const blockers: AvailabilityBlocker[] = [];
      for (const demand of demands) {
        const label = labels.get(demand.categoryId) ?? {
          name: 'Resource',
          noun: 'resource',
        };
        for (const date of request.dates) {
          const blocker = diagnoseDate(ctx, demand, date, {
            timeZone,
            label,
            names,
          });
          if (blocker) blockers.push(blocker);
        }
      }

      return {
        status: 'checked',
        categories: demands.map((demand) => ({
          categoryId: demand.categoryId,
          name: labels.get(demand.categoryId)?.name ?? 'Resource',
        })),
        blockers,
      };
    } catch (error) {
      return {
        status: 'unread',
        fault: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Naming. The gate context carries IDS only, and deliberately so: it must stay
// usable from the unauthenticated booking widget, which is not granted
// `resource.name` or `resource_category.name`. Claire's caller IS
// authenticated, so the display names are read separately here rather than
// widened on the engine, where they would leak to the widget.
//
// Two flat reads rather than the resources feature's own services: names are
// all that is wanted, and pulling the whole barrel into the assistant path to
// get them would drag its schemas and their module-init order along with it.
// ---------------------------------------------------------------------------

async function categoryLabels(
  db: Db,
  organizationId: string
): Promise<Map<string, CategoryLabel>> {
  const rows = await db.query.resourceCategory.findMany({
    columns: { id: true, name: true, kind: true },
    where: (row, { eq }) => eq(row.organizationId, organizationId),
  });
  return new Map(
    rows.map((row) => [
      row.id,
      {
        name: row.name,
        noun: resourceCategoryKindSingularLabels[row.kind].toLowerCase(),
      },
    ])
  );
}

async function resourceNames(
  db: Db,
  organizationId: string
): Promise<Map<string, string>> {
  const rows = await db.query.resource.findMany({
    columns: { id: true, name: true },
    where: (row, { eq }) => eq(row.organizationId, organizationId),
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

interface CategoryDemand {
  categoryId: string;
  /** Resource ids that may satisfy it, in the engine's own allocation order. */
  candidates: string[];
}

/**
 * Which resources may satisfy each required category — the ATTRIBUTION half of
 * what `filterSlotsByResources` decides internally.
 *
 * Mirrors the engine's rule that ZERO eligibility rows means "any resource in
 * this category", never "nothing qualifies". Inverting it here would have
 * Claire report a roomless service for every clinic that never restricted one
 * to specific rooms.
 */
function categoryDemands(ctx: ResourceGateContext): CategoryDemand[] {
  const narrowed = new Map<string, Set<string> | null>();
  for (const requirement of ctx.requirements) {
    if (requirement.eligibleResourceIds.length === 0) {
      if (!narrowed.has(requirement.categoryId)) {
        narrowed.set(requirement.categoryId, null);
      }
      continue;
    }
    const current = narrowed.get(requirement.categoryId) ?? null;
    const allowed = new Set(requirement.eligibleResourceIds);
    narrowed.set(
      requirement.categoryId,
      current === null
        ? allowed
        : new Set([...current].filter((id) => allowed.has(id)))
    );
  }

  const demands: CategoryDemand[] = [];
  for (const [categoryId, allowed] of narrowed) {
    const all = ctx.resourcesByCategory.get(categoryId) ?? [];
    demands.push({
      categoryId,
      candidates: allowed === null ? all : all.filter((id) => allowed.has(id)),
    });
  }
  return demands;
}

/**
 * Is this resource free at this instant?
 *
 * Capacity counts OVERLAPPING allocations (a double room takes two), and the
 * instant must fall inside one of the resource's own working intervals.
 *
 * No turnaround is added. The stored allocation ranges already carry their
 * cleanup tail, and the cart's turnaround extends a PROSPECTIVE hold — a
 * question about a slot someone is trying to book, not about what is holding
 * the room right now, which is what this explains.
 */
function freeAt(candidate: Candidate, instant: number): boolean {
  let overlapping = 0;
  for (const busy of candidate.busy) {
    if (instant >= busy.start && instant < busy.end) overlapping++;
  }
  if (overlapping >= candidate.capacity) return false;
  return candidate.working.some((w) => w.start <= instant && w.end > instant);
}

/**
 * Diagnose ONE category on ONE local day.
 *
 * Emitted per (category, date) rather than merged across dates: the contended
 * hours differ day to day, and a merged blocker would carry `windows` that
 * belong to no particular date — precise-looking and wrong.
 */
function diagnoseDate(
  ctx: ResourceGateContext,
  demand: CategoryDemand,
  date: string,
  opts: {
    timeZone: string;
    label: CategoryLabel;
    names: Map<string, string>;
  }
): AvailabilityBlocker | null {
  const base = {
    kind: 'no_free_resource' as const,
    dates: [date],
    categoryId: demand.categoryId,
    categoryName: opts.label.name,
    categoryNoun: opts.label.noun,
  };

  const day: Interval = {
    start: zonedDayStart(date, opts.timeZone),
    end: zonedDayEnd(date, opts.timeZone),
  };

  const candidates: Candidate[] = [];
  for (const resourceId of demand.candidates) {
    const availability = ctx.availabilityByResource.get(resourceId);
    if (!availability) continue;
    candidates.push({
      resourceId,
      name: opts.names.get(resourceId) ?? resourceId,
      capacity: availability.capacity,
      working: clamp(toIntervals(availability.working), day),
      busy: clamp(toIntervals(availability.busy), day),
    });
  }

  // Nothing eligible EXISTS. A settings gap rather than a diary one: the
  // service is gated on a category whose resources were all deleted,
  // deactivated, or sit at another location.
  if (candidates.length === 0) {
    return { ...base, windows: [], allDay: true, contention: [] };
  }

  const open = union(candidates.flatMap((c) => c.working));
  if (open.length === 0) {
    // Every eligible resource is shut all day. Fixable in settings, and
    // something no owner would ever guess from "there are no slots".
    return {
      ...base,
      windows: [],
      allDay: true,
      contention: candidates.map((c) => ({
        resourceId: c.resourceId,
        name: c.name,
        busy: [],
        closed: true,
      })),
    };
  }

  // Free-ness only changes at an interval endpoint, so testing the midpoint of
  // each gap between consecutive endpoints is EXACT — there is no probe
  // interval to tune, and no contended minute a coarse sweep could step over.
  const edges = new Set<number>([day.start, day.end]);
  for (const c of candidates) {
    for (const i of [...c.working, ...c.busy]) {
      edges.add(i.start);
      edges.add(i.end);
    }
  }
  const ordered = [...edges].sort((a, b) => a - b);

  const contendedRaw: Interval[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const segment = { start: ordered[i], end: ordered[i + 1] };
    if (segment.start >= segment.end) continue;
    const mid = segment.start + Math.floor((segment.end - segment.start) / 2);
    if (!open.some((o) => o.start <= mid && o.end > mid)) continue;
    if (candidates.some((c) => freeAt(c, mid))) continue;
    contendedRaw.push(segment);
  }

  const contended = union(contendedRaw);
  if (contended.length === 0) return null;

  const fmt = (instant: number) =>
    formatTimeInOrgZone(opts.timeZone, new Date(instant));

  const contention: ResourceContention[] = candidates
    .filter((c) =>
      contended.some(
        (w) =>
          c.busy.some((b) => overlaps(b, w)) ||
          !c.working.some((k) => k.start <= w.start && k.end >= w.end)
      )
    )
    .map((c) => ({
      resourceId: c.resourceId,
      name: c.name,
      busy: c.busy
        .filter((b) => contended.some((w) => overlaps(b, w)))
        .map((b) => ({ from: fmt(b.start), to: fmt(b.end) })),
      closed: !contended.every((w) =>
        c.working.some((k) => k.start <= w.start && k.end >= w.end)
      ),
    }));

  return {
    ...base,
    windows: contended.map((i) => ({ from: fmt(i.start), to: fmt(i.end) })),
    // Only a category that can serve NO open minute of the day writes the day
    // off. Two rooms booked 14:00-15:00 leave the other six hours bookable, and
    // saying otherwise reports a bigger outage than exists.
    allDay: measure(contended) >= measure(open),
    contention,
  };
}

// ---------------------------------------------------------------------------
// Interval helpers
// ---------------------------------------------------------------------------

const toIntervals = (ranges: { start: Date; end: Date }[]): Interval[] =>
  ranges.map((r) => ({ start: r.start.getTime(), end: r.end.getTime() }));

const clamp = (intervals: Interval[], within: Interval): Interval[] =>
  intervals
    .map((i) => ({
      start: Math.max(i.start, within.start),
      end: Math.min(i.end, within.end),
    }))
    .filter((i) => i.start < i.end);

/** Union of possibly-overlapping intervals, sorted ascending. */
function union(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** Milliseconds covered by a set of disjoint intervals. */
const measure = (intervals: Interval[]): number =>
  intervals.reduce((total, i) => total + (i.end - i.start), 0);

const overlaps = (a: Interval, b: Interval): boolean =>
  a.start < b.end && a.end > b.start;

// The org's calendar day as UTC instants, resolved with the SAME function the
// slot maths uses — re-deriving zone offsets here would drift by an hour twice
// a year and only on the days a clinic notices least.
const zonedDayStart = (date: string, timeZone: string): number =>
  zonedWallTimeToUtc(date, 0, timeZone).getTime();

const zonedDayEnd = (date: string, timeZone: string): number =>
  zonedWallTimeToUtc(date, 24 * 60, timeZone).getTime();
