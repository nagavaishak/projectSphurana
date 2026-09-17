/**
 * Availability capability port.
 *
 * Fourth application of the pattern, after `videos`, `meta-ads` and
 * `lead-forms` — and the first one that exists because of a MISSING capability
 * rather than a dishonest one.
 *
 * THE GAP. "Why can't customers book?" is among the most common things an
 * owner asks, and Claire could not answer it at all. She has
 * `appointments_findOpenSlots`, which returns the RESULT of the availability
 * calculation — so an empty answer was a dead end, not a diagnosis. A slot can
 * be missing for five independent reasons, and Gate 6 found she could read
 * none of them:
 *
 *   shifts          the practitioner's rota. THE sole HUMAN availability
 *                   source: no shift rows means unbookable, full stop.
 *   opening hours   the location's standing hours plus dated exceptions.
 *   blocked time    org-wide or per-practitioner blocks, recurrence-expanded.
 *   time off        approved leave.
 *   resources       the rooms, lasers and machines a service needs. A free
 *                   practitioner cannot take a booking that has nowhere to
 *                   happen, so this gates a slot exactly as hard as the rota
 *                   does — and it is the one an owner never thinks of.
 *
 * The fifth arrived with resource scheduling, and adding it here was not
 * optional. Left off, an org with two treatment rooms both booked at 14:00 gets
 * four clean reads and the answer "nothing is blocking this slot" — a
 * capability that was correct becoming actively wrong, which is worse than the
 * gap it replaced.
 *
 * THE HONESTY RULE, and the reason this is a port rather than five tools.
 * A diagnosis composed from five reads is only as good as the reads that
 * SUCCEEDED. If blocked-time is unreachable and the other four come back
 * clean, "nothing is blocking this slot" is a lie — the most expensive kind,
 * because the owner acts on it and the booking still fails.
 *
 * So `ExplainAvailabilityResult` has no boolean and no optional error field.
 * A complete answer (`read`) and an incomplete one (`partially_read`) are
 * different members, `partially_read` cannot be constructed without naming
 * the sources that failed, and `read` cannot be constructed without a
 * `ResourceCheckOutcome` — a value that does not exist for a resource check
 * that was skipped or that errored. There is no shape in which Claire can
 * report a clean diagnosis she did not actually complete.
 *
 * Five tools returning five bags could not express that: each would succeed or
 * fail on its own, and the CONCLUSION drawn across them would live in the
 * model's head, where nothing checks it.
 */

/** The five independent reasons a slot can be missing. */
export type AvailabilitySource =
  | 'shifts'
  | 'openingHours'
  | 'blockedTime'
  | 'timeOff'
  | 'resources';

/**
 * One eligible resource, and why it could not take the booking.
 *
 * Named individually because "no room is free" sends an owner hunting, while
 * "Room 2 and Room 3 are both booked 14:00–15:00" points at the two
 * appointments they can actually move.
 */
export interface ResourceContention {
  resourceId: string;
  /** What the clinic calls it — "Room 2", "Lumenis M22". */
  name: string;
  /** Wall-clock ranges holding it, in the org's zone: `{ from: '14:00', to: '15:00' }`. */
  busy: { from: string; to: string }[];
  /**
   * Its own hours do not cover the contended window at all. Distinct from
   * `busy`: a shut room is a settings problem, a booked one is a diary problem.
   */
  closed: boolean;
}

/**
 * One reason the requested window is not bookable.
 *
 * Each carries the DATES it applies to, because "you have no rota" and "you
 * have no rota on the 3rd" are different problems with different fixes.
 */
export type AvailabilityBlocker =
  /** No shift rows at all in the window — the unbookable-service case. */
  | { kind: 'no_shifts'; dates: string[]; practitionerIds: string[] }
  /** Rota exists but the day is explicitly marked off. */
  | { kind: 'day_off'; dates: string[]; practitionerIds: string[] }
  /** The location is closed (standing hours or a dated exception). */
  | { kind: 'location_closed'; dates: string[]; locationId: string }
  /** A blocked-time occurrence overlaps. `practitionerIds` empty = org-wide. */
  | {
      kind: 'blocked_time';
      dates: string[];
      practitionerIds: string[];
      label: string | null;
    }
  /** Approved leave overlaps. */
  | { kind: 'time_off'; dates: string[]; practitionerId: string }
  /**
   * Every resource that could have served a required category is taken or shut.
   *
   * The only blocker that is usually PARTIAL — two rooms booked 14:00–15:00
   * leave the rest of the day bookable — which is why it carries `windows` and
   * `allDay` rather than only dates. A consumer that treats it like the others
   * and writes the whole day off is reporting a bigger outage than exists.
   */
  | {
      kind: 'no_free_resource';
      dates: string[];
      categoryId: string;
      /** The clinic's own name for the category — "Treatment rooms". */
      categoryName: string;
      /** Singular noun for copy — "room", "equipment", "resource". */
      categoryNoun: string;
      /**
       * Wall-clock windows on `dates`, in the org's zone, with nothing free.
       * Empty means the category could not serve those dates at any time.
       */
      windows: { from: string; to: string }[];
      /**
       * Nothing eligible can serve ANY of the day's open time. The only case in
       * which this blocker removes a date from `bookableDates`.
       */
      allDay: boolean;
      /** Every resource that could have served, and what is holding it. */
      contention: ResourceContention[];
    };

/**
 * What the resource check LEARNED.
 *
 * Carried as a REQUIRED field on `read`, so a complete answer cannot be
 * assembled while the fifth source went unasked. There is deliberately no
 * member meaning "skipped" or "failed" — those are `resources` appearing in
 * `unread` on `partially_read`, and no `read` can be built from them.
 */
export type ResourceCheckOutcome =
  /**
   * Nothing in scope requires a room, machine or chair, so the question does
   * not arise. NOT the same as "checked, and something was free": conflating
   * the two would have Claire raise a phantom room problem for every clinic
   * that has never configured one — which today is nearly all of them.
   */
  | { kind: 'not_applicable' }
  /**
   * Checked. These categories had to be free for the service to happen; any
   * that were not are in `blockers` as `no_free_resource`.
   */
  | {
      kind: 'checked';
      categories: { categoryId: string; name: string }[];
    };

/**
 * Why the diagnosis could not run at all. Split from a partial read on
 * purpose: this means we learned nothing, not that we learned some of it.
 */
export type AvailabilityBlockedReason =
  /** The caller asked about a practitioner or location that is not in this org. */
  | { kind: 'not_found'; what: 'practitioner' | 'location'; id: string }
  /** `to` before `from`, window too wide, unparseable dates. */
  | { kind: 'invalid_window'; message: string }
  /** The server stated a refusal this union does not name — carry it verbatim
   *  rather than mis-classify it. */
  | { kind: 'other'; message: string }
  /** The server faulted. Alertable, and NOT an owner-actionable refusal. */
  | { kind: 'server_error'; message: string };

/** The window actually examined, echoed back so a caller cannot misreport it. */
export interface AvailabilityWindow {
  /** YYYY-MM-DD. */
  from: string;
  /** YYYY-MM-DD. */
  to: string;
  practitionerId: string | null;
  locationId: string | null;
  /** The service the resource check was run for, if one was named. */
  serviceId: string | null;
}

export type ExplainAvailabilityResult =
  /**
   * All five sources read. `blockers` empty means genuinely bookable — this is
   * the ONLY member in which that statement is true.
   */
  | {
      status: 'read';
      window: AvailabilityWindow;
      blockers: AvailabilityBlocker[];
      /** Dates with at least one working interval after everything applies. */
      bookableDates: string[];
      /** Required — a complete read must state what the resource check found. */
      resources: ResourceCheckOutcome;
    }
  /**
   * Some sources failed. The blockers listed are real, but the absence of a
   * blocker proves NOTHING for an unread source — which is why `unread` is
   * required and non-empty by construction of the caller.
   *
   * Consumers must phrase this as "I checked X and Y; I could not check Z."
   */
  | {
      status: 'partially_read';
      window: AvailabilityWindow;
      blockers: AvailabilityBlocker[];
      bookableDates: string[];
      unread: AvailabilitySource[];
      /** `null` ⇒ `'resources'` is named in `unread`; there is no third state. */
      resources: ResourceCheckOutcome | null;
    }
  /** Nothing was learned. */
  | { status: 'blocked'; reason: AvailabilityBlockedReason };

export interface ExplainAvailabilityInput {
  /** YYYY-MM-DD. */
  from: string;
  /** YYYY-MM-DD. */
  to: string;
  /** Narrow to one practitioner. Omit for the whole org. */
  practitionerId?: string;
  /** Required to check opening hours — without it that source is skipped and
   *  reported as unread rather than silently ignored. */
  locationId?: string;
  /**
   * Required to check ROOMS AND EQUIPMENT, because what a booking needs is a
   * property of the SERVICE, not of the window. Without it the resource source
   * is reported unread — unless the org has no resource requirements anywhere,
   * which is a real answer (`not_applicable`) rather than a gap.
   */
  serviceId?: string;
}

export interface AvailabilityPort {
  /**
   * Answer "why can't customers book?" for a window, by composing the five
   * independent availability sources and naming any it could not reach.
   */
  explainAvailability(
    input: ExplainAvailabilityInput
  ): Promise<ExplainAvailabilityResult>;
}
