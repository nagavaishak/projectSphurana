import {
  listBlockedTimeResponseSchema,
  listShiftsResponseSchema,
  listTimeOffResponseSchema,
  locationScheduleResultSchema,
} from '@borradh-workspace/contracts';
import type {
  AvailabilityBlocker,
  AvailabilityPort,
  AvailabilitySource,
  AvailabilityWindow,
  ExplainAvailabilityInput,
  ExplainAvailabilityResult,
} from '@borradh-workspace/contracts/ports';
import { ApiFetchError, type ApiFetchFn } from '../tool-factory/api-fetch.js';
import type { ResourceReader } from './resource-availability.reader.js';

/**
 * Derived rather than imported by name: `ResourceCheckOutcome` is declared in
 * `availability.port.ts` but the ports barrel does not re-export it yet. Taking
 * it off `ExplainAvailabilityResult` binds to the SAME declaration, so the
 * moment the barrel exports the alias this can become a plain import with no
 * behaviour change — and until then nothing here can drift from the contract.
 */
type ResourceCheckOutcome = Extract<
  ExplainAvailabilityResult,
  { status: 'read' }
>['resources'];

export interface AvailabilityPortDeps {
  apiFetch: ApiFetchFn;
  /**
   * The FIFTH source. Optional because it is the one read that does NOT go over
   * `apiFetch`: resource routes exist, but they return the inputs to the gating
   * decision rather than the decision, so the reader drives the booking engine
   * itself and needs an org id and a time zone this constructor is not given
   * (see `resource-availability.reader.ts` for why that is the right trade).
   *
   * Optional is not a loophole. Omit it and every result is `partially_read`
   * with `'resources'` in `unread`: the port cannot be talked into a clean
   * verdict by leaving a source unwired, which is exactly the property that
   * makes the honesty rule hold as sources are added.
   */
  readResources?: ResourceReader;
}

/**
 * A 4xx is the API stating a reason; anything else is the server breaking.
 * Only the fault side may reach Sentry — collapsing the two is what made
 * ordinary "no, because…" answers page someone.
 */
function isServerFault(error: unknown): boolean {
  return !(
    error instanceof ApiFetchError &&
    error.status >= 400 &&
    error.status < 500
  );
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown error';

/** ISO date (YYYY-MM-DD) for a Date, in UTC. */
const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Every YYYY-MM-DD in [from, to] inclusive. */
function datesInWindow(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
    out.push(isoDate(d));
  }
  return out;
}

/** The YYYY-MM-DDs a [start, end] instant range touches, clamped to the window. */
function datesTouched(
  startISO: string,
  endISO: string,
  window: Set<string>
): string[] {
  const out: string[] = [];
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;
  for (
    let d = new Date(`${isoDate(start)}T00:00:00.000Z`);
    d <= end;
    d = new Date(d.getTime() + 86_400_000)
  ) {
    const key = isoDate(d);
    if (window.has(key)) out.push(key);
  }
  return out;
}

const qs = (params: Record<string, string | undefined>): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  return sp.toString();
};

/**
 * Availability port — see `packages/contracts/src/ports/availability.port.ts`
 * for why a diagnosis composed from five reads must distinguish "checked
 * everything and found nothing" from "could not check everything".
 *
 * Every HTTP read is PARSED against its contract schema rather than asserted,
 * so a projection that drifts fails here instead of silently yielding
 * `undefined` fields that read as "no blockers". The resource read has no
 * projection to drift: it calls the booking engine that gates the slots.
 */
export function createAvailabilityPort(
  deps: AvailabilityPortDeps
): AvailabilityPort {
  const { apiFetch, readResources } = deps;

  return {
    async explainAvailability(
      input: ExplainAvailabilityInput
    ): Promise<ExplainAvailabilityResult> {
      const { from, to, practitionerId, locationId, serviceId } = input;

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(to)
      ) {
        return {
          status: 'blocked',
          reason: {
            kind: 'invalid_window',
            message: 'from and to must be YYYY-MM-DD dates.',
          },
        };
      }
      if (to < from) {
        return {
          status: 'blocked',
          reason: {
            kind: 'invalid_window',
            message: `to (${to}) is before from (${from}).`,
          },
        };
      }

      const window: AvailabilityWindow = {
        from,
        to,
        practitionerId: practitionerId ?? null,
        locationId: locationId ?? null,
        serviceId: serviceId ?? null,
      };
      const windowDates = datesInWindow(from, to);
      const windowSet = new Set(windowDates);

      const unread: AvailabilitySource[] = [];
      const blockers: AvailabilityBlocker[] = [];
      /** Server faults seen while reading. A fault on EVERY source is a blocked
       *  result; a fault on some is a partial read. */
      let firstFault: string | undefined;

      const range = qs({ from, to, practitionerId });

      // ---- shifts: the sole availability source ---------------------------
      const workingDates = new Set<string>();
      let shiftsRead = false;
      try {
        const days = await apiFetch(`shifts?${range}`, {
          schema: listShiftsResponseSchema,
        });
        shiftsRead = true;

        const offDates = new Set<string>();
        const offBy = new Map<string, Set<string>>();
        for (const day of days) {
          if (!windowSet.has(day.date)) continue;
          if (day.isOff || day.intervals.length === 0) {
            offDates.add(day.date);
            const set = offBy.get(day.date) ?? new Set<string>();
            set.add(day.practitionerId);
            offBy.set(day.date, set);
          } else {
            workingDates.add(day.date);
          }
        }

        // No rows at all in the window is categorically different from "the
        // rota says off": it is the unbookable-service case, and the fix is to
        // create shifts rather than to change one.
        if (days.length === 0) {
          blockers.push({
            kind: 'no_shifts',
            dates: windowDates,
            practitionerIds: practitionerId ? [practitionerId] : [],
          });
        } else {
          const dayOffDates = [...offDates].filter((d) => !workingDates.has(d));
          if (dayOffDates.length > 0) {
            blockers.push({
              kind: 'day_off',
              dates: dayOffDates.sort(),
              practitionerIds: [
                ...new Set(
                  dayOffDates.flatMap((d) => [...(offBy.get(d) ?? [])])
                ),
              ].sort(),
            });
          }
        }
      } catch (error) {
        unread.push('shifts');
        if (isServerFault(error)) firstFault ??= messageOf(error);
      }

      // ---- opening hours: only checkable with a location -------------------
      if (locationId) {
        try {
          const schedule = await apiFetch(
            `locations/${encodeURIComponent(locationId)}/opening-hours?${qs({ from, to })}`,
            { schema: locationScheduleResultSchema }
          );
          const closed = (schedule.exceptions ?? [])
            .filter((e) => e.closed && windowSet.has(e.date))
            .map((e) => e.date)
            .sort();
          if (closed.length > 0) {
            blockers.push({
              kind: 'location_closed',
              dates: closed,
              locationId,
            });
          }
        } catch (error) {
          unread.push('openingHours');
          if (isServerFault(error)) firstFault ??= messageOf(error);
        }
      } else {
        // NOT silently skipped. Without a location we genuinely cannot say
        // whether the door was open, and a caller must be able to see that.
        unread.push('openingHours');
      }

      // ---- blocked time ----------------------------------------------------
      try {
        const blocks = await apiFetch(`blocked-time?${range}`, {
          schema: listBlockedTimeResponseSchema,
        });
        for (const b of blocks) {
          const dates = datesTouched(
            String(b.startDate),
            String(b.endDate),
            windowSet
          );
          if (dates.length === 0) continue;
          blockers.push({
            kind: 'blocked_time',
            dates,
            practitionerIds: b.practitionerIds ?? [],
            label: b.title ?? null,
          });
        }
      } catch (error) {
        unread.push('blockedTime');
        if (isServerFault(error)) firstFault ??= messageOf(error);
      }

      // ---- time off --------------------------------------------------------
      try {
        const leave = await apiFetch(`time-off?${range}`, {
          schema: listTimeOffResponseSchema,
        });
        for (const t of leave) {
          const dates = datesTouched(
            String(t.startDate),
            String(t.endDate),
            windowSet
          );
          if (dates.length === 0) continue;
          blockers.push({
            kind: 'time_off',
            dates,
            practitionerId: t.practitionerId,
          });
        }
      } catch (error) {
        unread.push('timeOff');
        if (isServerFault(error)) firstFault ??= messageOf(error);
      }

      // ---- resources: rooms, lasers, machines ------------------------------
      // The fifth source, and the one an owner never thinks of: a free
      // practitioner cannot take a booking that has nowhere to happen.
      //
      // `not_applicable` is a REAL answer here, not a skipped check. It is what
      // comes back for every org that has never configured a room, and treating
      // it as unread would deny all of them the complete answer they had before
      // resources existed. Treating a genuine failure as `not_applicable` is
      // the mirror-image mistake, and the one this port was built to forbid.
      let resources: ResourceCheckOutcome | null = null;
      if (readResources) {
        const read = await readResources({
          from,
          to,
          dates: windowDates,
          serviceId,
          locationId,
        });
        if (read.status === 'unread') {
          unread.push('resources');
          if (read.fault) firstFault ??= read.fault;
        } else if (read.status === 'not_applicable') {
          resources = { kind: 'not_applicable' };
        } else {
          resources = { kind: 'checked', categories: read.categories };
          blockers.push(...read.blockers);
        }
      } else {
        // No reader wired. We did not look, so we do not get to say it is
        // clear — see `AvailabilityPortDeps.readResources`.
        unread.push('resources');
      }

      // Every source failed — we learned nothing, which is not a partial read.
      if (unread.length === 5) {
        return {
          status: 'blocked',
          reason: firstFault
            ? { kind: 'server_error', message: firstFault }
            : {
                kind: 'other',
                message: 'None of the availability sources could be read.',
              },
        };
      }

      // Subtract everything that blocks from the days the rota says are worked.
      //
      // `no_free_resource` is the one blocker that is usually PARTIAL: two rooms
      // taken 14:00-15:00 leave the rest of the day bookable. Writing the whole
      // date off for it would report a bigger outage than exists, so only a
      // category that can serve no open minute of the day (`allDay`) counts.
      const blockedDates = new Set(
        blockers.flatMap((b) =>
          b.kind === 'no_free_resource' && !b.allDay ? [] : b.dates
        )
      );
      const bookableDates = [...workingDates]
        .filter((d) => !blockedDates.has(d))
        .sort();

      if (unread.length > 0) {
        return {
          status: 'partially_read',
          window,
          blockers,
          // If the rota itself was unread we know of no working day, and must
          // not present an empty list as "nothing is bookable".
          bookableDates: shiftsRead ? bookableDates : [],
          unread,
          // Non-null only when the resource read SUCCEEDED and something else
          // did not. Null and `'resources' in unread` are the same fact.
          resources,
        };
      }

      // `resources` is non-null on every path that reaches here: the only ways
      // it stays null push `'resources'` onto `unread`, and a non-empty `unread`
      // returned above. The assertion keeps that reasoning checked rather than
      // remembered.
      /* istanbul ignore next -- unreachable; see above */
      if (!resources) {
        return {
          status: 'blocked',
          reason: {
            kind: 'other',
            message: 'The room and equipment check did not report an outcome.',
          },
        };
      }

      return { status: 'read', window, blockers, bookableDates, resources };
    },
  };
}
