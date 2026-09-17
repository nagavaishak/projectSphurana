/**
 * Practitioners (team roster) capability port.
 *
 * Fifth application of the pattern, and the second one that exists because a
 * capability was MISSING rather than dishonest.
 *
 * THE GAP, from the Gate 6 sweep — the sharpest one found.
 * `appointments_bookAppointment` accepts an optional `practitionerId`, and
 * NOTHING in the toolset could produce one. `GET /practitioners`,
 * `GET /practitioners/for-service/:serviceId` and the org member list had no
 * tool between them. So Claire could book a person she could not name, and
 * reached a practitioner only as an id echoed back out of an appointment she
 * had already read. The same gap blocks `shifts_explainAvailability`, whose
 * `practitionerId` the model likewise had no way to obtain.
 *
 * Two facts, one question. "Who works here?" and "who does balayage?" are the
 * same read at two grains — the second is a filter on the first, not a
 * different act. They are two METHODS here because they are two endpoints with
 * genuinely different projections (see `serviceIds` below), but they return
 * the SAME union so a consumer branches once.
 *
 * THE HONESTY RULES, both learned from the availability port:
 *
 * 1. A PAGE IS NOT A ROSTER. `GET /practitioners` is paginated and returns no
 *    total, so a full page is indistinguishable from a truncated one at the
 *    call site. Presenting 50 of 120 staff as "your team" is the availability
 *    lie in miniature — the owner acts on a list that silently omits the
 *    person they were asking about. `partially_read` is therefore a MEMBER,
 *    not a `truncated: boolean` a consumer can forget to read, and it cannot
 *    be constructed without saying how to get the rest.
 *
 * 2. AN UNLOADED RELATION IS NOT AN EMPTY ONE. `for-service` loads locations
 *    but not services, so `services` comes back absent rather than `[]`.
 *    Collapsing those to `serviceIds: []` would have Claire state that a
 *    stylist performs no services, which is both false and actionable in the
 *    worst way. Hence `string[] | null`, with null meaning "not loaded".
 *
 * WHAT THIS PORT DELIBERATELY DOES NOT CARRY. The practitioner row holds
 * `email`, `phone`, `phoneSecondary`, `dateOfBirth`, `employmentStartDate`,
 * `employmentEndDate`, `employmentType`, `country` and free-text `notes`. None
 * of it is in `TeamMember`. The roster fact Claire needs is the one printed on
 * a public booking page — who, what they are called, and whether they can be
 * booked. (Wages live on a separate table behind
 * `GET /wage-configs/:practitionerId`, which this port does not touch at all.)
 */

/**
 * One bookable staff member, projected to the booking-page facts.
 *
 * Note what is NOT here: contact details, date of birth, employment dates and
 * type, and internal notes are all on the underlying row and all deliberately
 * dropped. See the file header.
 */
export interface TeamMember {
  id: string;
  /** Display name, as the org set it. */
  name: string;
  /** Job title ("Senior Stylist"), when set. */
  title: string | null;
  /** Soft-disabled staff are still on the roster but not bookable. */
  isActive: boolean;
  /**
   * Whether the org lets customers book this person at all. A member can be
   * `isActive` and still not accept bookings (a manager who does no services),
   * which is why the two are separate.
   */
  acceptsBookings: boolean;
  /**
   * Services this person is assigned to.
   *
   * `null` means the relation WAS NOT LOADED by the endpoint that produced
   * this record — it does NOT mean "performs no services". Never render null
   * as an empty list.
   */
  serviceIds: string[] | null;
  /** Locations they work from. `null` = relation not loaded, as above. */
  locationIds: string[] | null;
}

/**
 * What the roster read actually asked for, echoed back so a caller cannot
 * misreport its own answer.
 *
 * `for_service` carries `activeOnly: true` as a literal because the endpoint
 * hardcodes it: there is no way to ask that route about inactive staff, and a
 * consumer must be able to see that constraint rather than infer it.
 */
export type RosterScope =
  | { kind: 'whole_team'; search: string | null; includesInactive: boolean }
  | {
      kind: 'for_service';
      serviceId: string;
      search: string | null;
      activeOnly: true;
    };

/** Why the roster could not be read at all — nothing was learned. */
export type RosterBlockedReason =
  /** The service id is not in this org (or does not exist). */
  | { kind: 'not_found'; what: 'service'; id: string }
  /** Empty/malformed id, nonsensical paging. */
  | { kind: 'invalid_input'; message: string }
  /** The server stated a refusal this union does not name — carried verbatim
   *  rather than mis-classified. */
  | { kind: 'other'; message: string }
  /** The server faulted. Alertable, and NOT an owner-actionable refusal. */
  | { kind: 'server_error'; message: string };

export type PractitionerRosterResult =
  /**
   * Every member matching `scope` was returned. This is the ONLY member in
   * which "that's the whole team" is a true statement.
   */
  | { status: 'read'; scope: RosterScope; members: TeamMember[] }
  /**
   * A full page came back and the endpoint reports no total, so more staff may
   * exist beyond it. The members listed are real; their COUNT proves nothing.
   *
   * Consumers must phrase this as "here are the first N" and never as "you
   * have N staff". `more` is required so the answer always carries its own
   * continuation.
   */
  | {
      status: 'partially_read';
      scope: RosterScope;
      members: TeamMember[];
      more: { returned: number; limit: number; nextOffset: number };
    }
  /** Nothing was learned. */
  | { status: 'blocked'; reason: RosterBlockedReason };

export interface ListPractitionersInput {
  /** Case-insensitive match on name or email. */
  search?: string;
  /** Include soft-disabled staff. Default false — active roster only. */
  includeInactive?: boolean;
  /** Page size, 1–100. Default 50. */
  limit?: number;
  /** Page offset. Default 0. */
  offset?: number;
}

export interface FindPractitionersForServiceInput {
  serviceId: string;
  /**
   * Case-insensitive name/email narrowing. Applied by the adapter over the
   * returned set, because the endpoint takes no search parameter — declared
   * here rather than dropped so the filter is never silently ignored.
   */
  search?: string;
}

export interface PractitionersPort {
  /** The staff roster: who works here, and can they be booked. */
  listPractitioners(
    input: ListPractitionersInput
  ): Promise<PractitionerRosterResult>;

  /**
   * Who is ASSIGNED to perform a service.
   *
   * Assignment, not bookability: this consults the practitioner↔service join
   * only. Whether the person actually has a rota, works the right location, or
   * accepts bookings at all are separate questions — `acceptsBookings` is
   * carried on each member for that reason, and the rota belongs to
   * `AvailabilityPort`.
   */
  findForService(
    input: FindPractitionersForServiceInput
  ): Promise<PractitionerRosterResult>;
}
