/**
 * appointments request CONTRACTS — the canonical, strict Zod schema for the
 * BODY of each appointment write endpoint.
 *
 * A request contract is the wire-shaped twin of a response projection: it
 * describes exactly what the client is allowed to POST/PUT, written here in
 * pure Zod so it stays frontend-safe (no drizzle / database in the runtime
 * graph — see index.ts).
 *
 * DIRECTION OF DERIVATION — wire -> server
 * ---------------------------------------
 * This file is the SOURCE. The feature schemas under
 * `packages/features/src/appointments/services/…` DERIVE from it by
 * `.extend()`ing the server-injected context fields onto the base:
 *
 *     createAppointmentBaseSchema = createAppointmentRequestBase.extend({ … })
 *     updateAppointmentBaseSchema = updateAppointmentRequestBase.extend({ … })
 *     checkAvailabilitySchema     = findOpenSlotsRequestBase.extend({ … })
 *
 * Because the server schema literally IS the wire schema plus fields, it can
 * never be laxer than the wire schema, and no drift is possible. Do NOT invert
 * this — a contract hand-copied from the feature schema is exactly the drift
 * this package exists to eliminate.
 *
 * BASE vs SCHEMA — why two exports
 * --------------------------------
 * `.refine()` returns a `ZodEffects`, which has NO `.extend()`. So every
 * contract exports a matched pair:
 *
 *  - `<name>RequestBase`   — a plain `z.object({…})`. EXTENDABLE. This is what
 *    the backend feature schema extends with its context fields. It is NOT
 *    strict, because `.strict()` would reject the very fields being added.
 *  - `<name>RequestSchema` — `<name>RequestBase.strict()` (plus any
 *    `.refine()`). This is what VALIDATES a wire body: unknown fields are
 *    REJECTED, so a client sending a stale, renamed or typo'd key fails loudly
 *    instead of having it silently stripped by a permissive `z.object`.
 *
 * DATES — the one field family that cannot be shared verbatim
 * -----------------------------------------------------------
 * A JSON body carries an ISO STRING; the service wants a `Date`. So the wire
 * contract declares `z.string().datetime()` and the feature schema OVERRIDES
 * exactly those keys back to `z.coerce.date()` in its `.extend()`. That is the
 * single deliberate exception to "the server schema is the wire schema plus
 * fields": for date keys the server schema is the wire schema plus fields, with
 * the same keys re-typed to the parsed representation. Optionality and
 * presence still come from here, so a date field cannot silently become
 * required on one side only — only its REPRESENTATION differs, and the
 * `z.coerce.date()` on the server accepts precisely the strings this contract
 * admits.
 *
 * Context fields the SERVER injects are absent from every body contract:
 *  - `organizationId` — taken from the active-org session, never sent by the
 *    client. The feature schema adds it back via `.extend()`.
 *  - `id` on update — a ROUTE PARAM (`PUT /appointments/:id`), never a body key.
 *  - `assignedToId` on create is optional on the wire; the controller defaults
 *    it to the current user, and the service-level schema then re-declares it
 *    required.
 */
import {
  appointmentColorValues,
  appointmentSourceValues,
  appointmentStatusValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * One line item in the appointment's "cart" (Fresha multi-service booking) —
 * the EXTENDABLE half.
 *
 * `name` / `durationMinutes` / `priceCents` are SNAPSHOTS taken at booking time
 * so renaming/repricing/deleting a catalog service never rewrites history.
 * `serviceId` is the (optional) pointer back to the catalog row — a fully
 * custom, off-catalog line has no serviceId.
 *
 * `practitionerId` is a plain `z.string()` here: the branded `zId<'Practitioner'>`
 * lives in the features package (it is a server-side type-safety device, not a
 * wire constraint), and contracts must stay dependency-pure. The feature schema
 * overrides this key with the branded version when it derives.
 */
export const appointmentServiceLineRequestBase = z.object({
  serviceId: z.string().optional(),
  // The customer-chosen variant on this line, if any. When set (and it resolves
  // to an active variant of `serviceId` in the org) the service snapshots the
  // variant's price/duration/name over the values below.
  variantId: z.string().optional(),
  name: z.string().min(1, 'Service name is required'),
  durationMinutes: z.number().int().min(0),
  priceCents: z.number().int().nullable().optional(),
  practitionerId: z.string().min(1).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

/** The VALIDATING half of a cart line. */
export const appointmentServiceLineRequestSchema =
  appointmentServiceLineRequestBase.strict();

/**
 * `POST /appointments` body — the EXTENDABLE half.
 *
 * Every field carries the exact validation the server enforces, including the
 * `.default(…)`s on `color` / `status` / `source`: because the feature schema
 * is this object plus context fields, moving a default here does not change
 * server behaviour, it just makes the same default visible to the client. Note
 * that `.default()` means a PARSED body CONTAINS these keys even when the
 * caller omitted them — `createAppointmentRequestSchema.parse({ title,
 * startDate, endDate, leadId })` emits `color: 'blue'`, `status: 'booked'` and
 * `source: 'manual'`.
 *
 * `endDate` is OPTIONAL. It used to be required here while the feature schema
 * had it optional — the contract was describing a stricter API than the one
 * that ships. The server derives the end from `startDate + sum(services[].
 * durationMinutes)` when a cart is supplied, so a cart booking legitimately
 * omits it. The invariant that survives is conditional and lives on the
 * strict half below: you must supply an end SOMEHOW, and if you supply it
 * explicitly it must be after the start.
 */
export const createAppointmentRequestBase = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  startDate: z.string().datetime(),
  // Optional when a `services` cart is supplied — the end is then derived from
  // startDate + sum(durationMinutes). Still required for single-service/manual
  // bookings that pass no cart.
  endDate: z.string().datetime().optional(),
  color: z.enum(appointmentColorValues).optional().default('blue'),
  status: z.enum(appointmentStatusValues).optional().default('booked'),
  source: z.enum(appointmentSourceValues).optional().default('manual'),
  // When to release the slot if the hold is never resolved. Only meaningful
  // alongside `status: 'held'`; `expireAppointmentHolds` reads both.
  holdExpiresAt: z.string().datetime().optional().nullable(),
  leadId: z.string().min(1, 'Lead ID is required'),
  // Optional in the body — the controller defaults it to the current user.
  assignedToId: z.string().min(1).optional(),
  calendarAccountId: z.string().optional(),
  externalCalendarEventId: z.string().optional(),
  practitionerId: z.string().min(1).optional(),
  serviceId: z.string().optional(),
  // The Fresha "cart": several services on one appointment. When present the
  // service inserts N `appointment_service` line items, sets the appointment's
  // primary `serviceId` to the first item, and (when `endDate` is omitted)
  // derives the end from the summed durations.
  services: z.array(appointmentServiceLineRequestBase).optional(),
  // Rooms & equipment the front desk picked itself. Omitted ⇒ the server
  // auto-assigns from the service's required categories; an org with no
  // resource requirements ignores it entirely.
  //
  // This half is `.strict()`, so a key missing HERE is a 400 no matter what
  // the feature schema accepts — the explicit-room create path was rejected at
  // the DTO and never reached the service.
  resourceIds: z.array(z.string().min(1)).optional(),
  // "I was shown the clash and I mean it." Only meaningful with `resourceIds`,
  // and the service honours it for console bookings only — a customer on the
  // public booking page can send it and it will be dropped.
  allowResourceOverbook: z.boolean().optional(),
  // The site this booking is at. Not stored on the appointment — it filters
  // which rooms the allocator may choose from, so a two-site clinic is not
  // handed the other building's room.
  locationId: z.string().min(1).nullable().optional(),
  /**
   * Explicit consent to create an appointment that OVERLAPS an existing one
   * for the same practitioner (ENG-792).
   *
   * Double-booking is a supported clinic workflow — two chairs, an assistant
   * running a second treatment, a walk-in squeezed in. What was not supported
   * was doing it SILENTLY: `source: 'manual'` skipped the overlap check
   * entirely and set `allow_double_booking = true` on the row, which also took
   * it out of the `appointment_no_overlap` DB constraint. Two clashing
   * appointments for one practitioner were created with no warning, no
   * confirmation, and an "Appointment created" toast.
   *
   * Now the server always checks, and a clash is a `409` naming the conflicting
   * appointment. The caller may then re-send with this flag to say "yes,
   * deliberately" — so the conflict is always identified before it is accepted.
   * Absent/false is the safe default: an integration that has never heard of
   * this field gets the protection rather than the bypass.
   *
   * Orthogonal to `allowResourceOverbook`: that one is about a ROOM already
   * being held, this one about the PERSON already being booked. A front desk
   * can hit either, both, or neither.
   */
  allowDoubleBooking: z.boolean().optional().default(false),
});

/**
 * `POST /appointments` body — the VALIDATING half. Use this everywhere a body
 * is parsed (API DTO, frontend payload builder). Unknown keys are rejected, so
 * `organizationId` in a body is an error, not a silently-ignored field.
 *
 * The two refinements mirror the ones on the service-level schema. They have to
 * be RESTATED rather than shared, because a `.refine()` produces a ZodEffects
 * that the feature schema could not then `.extend()` — the price of the
 * Base/Schema split. Keep them in step with
 * `create-appointment.schema.ts`.
 *
 * Dates are compared as instants, not as strings: `2026-01-01T10:00:00Z` and
 * `2026-01-01T10:00:00.000Z` are the same moment but do not compare equal
 * lexicographically.
 */
export const createAppointmentRequestSchema = createAppointmentRequestBase
  .strict()
  // Need an end for the appointment: either an explicit endDate OR a non-empty
  // cart to derive it from.
  .refine(
    (data) =>
      data.endDate !== undefined ||
      (data.services !== undefined && data.services.length > 0),
    {
      message: 'endDate is required when no services are provided',
      path: ['endDate'],
    }
  )
  .refine(
    (data) =>
      data.endDate === undefined ||
      Date.parse(data.endDate) > Date.parse(data.startDate),
    {
      message: 'End date must be after start date',
      path: ['endDate'],
    }
  );

export type CreateAppointmentRequest = z.infer<
  typeof createAppointmentRequestSchema
>;

/**
 * `PUT /appointments/:id` body — the EXTENDABLE half.
 *
 * Every field is optional because the endpoint applies PATCH semantics: a key
 * ABSENT from the body is left untouched, whereas an explicit `null` on a
 * nullable column CLEARS it. That distinction is why the nullable keys are
 * `.optional().nullable()` and not merely `.optional()` — collapsing the two
 * would make "clear the note" indistinguishable from "leave the note alone".
 *
 * `id` is the route param and `organizationId` is server-injected; both are
 * added back by the feature schema's `.extend()`.
 *
 * `sendRescheduleEmail` / `rescheduleMessage` are not columns — they are
 * instructions to the update service about the notification it should send.
 */
export const updateAppointmentRequestBase = z.object({
  title: z.string().min(1, 'Title is required').optional(),
  description: z.string().optional().nullable(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  color: z.enum(appointmentColorValues).optional(),
  status: z.enum(appointmentStatusValues).optional(),
  leadId: z.string().min(1).optional(),
  assignedToId: z.string().min(1).optional(),
  calendarAccountId: z.string().optional().nullable(),
  externalCalendarEventId: z.string().optional().nullable(),
  practitionerId: z.string().optional().nullable(),
  serviceId: z.string().optional().nullable(),
  sendRescheduleEmail: z.boolean().optional(),
  rescheduleMessage: z.string().optional(),
  /**
   * Explicit consent to move this appointment ONTO an overlapping slot — the
   * reschedule twin of the create flag. Dragging an appointment on the staff
   * calendar took the same `source === 'manual'` bypass, so a drag could land
   * on top of another booking just as silently (ENG-792).
   */
  allowDoubleBooking: z.boolean().optional(),
});

/**
 * `PUT /appointments/:id` body — the VALIDATING half.
 *
 * The invariant is CONDITIONAL: a PATCH that moves only the start (or only the
 * end) cannot be checked against a value it did not send, so the ordering is
 * enforced only when BOTH instants are present in the same body. This mirrors
 * `updateAppointmentSchema`; see the note on the create schema about why the
 * refinement is restated rather than shared.
 */
export const updateAppointmentRequestSchema = updateAppointmentRequestBase
  .strict()
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return Date.parse(data.endDate) > Date.parse(data.startDate);
      }
      return true;
    },
    {
      message: 'End date must be after start date',
      path: ['endDate'],
    }
  );

export type UpdateAppointmentRequest = z.infer<
  typeof updateAppointmentRequestSchema
>;

/**
 * `POST /appointments/open-slots` body — the EXTENDABLE half.
 *
 * The endpoint is a POST that READS (it asks the calendar provider for free
 * slots), so its input is a body rather than a query string and it gets a
 * request contract like any write.
 *
 * `date` is a CALENDAR DAY, not an instant — a `YYYY-MM-DD` string, deliberately
 * not `z.string().datetime()`: "which day are you asking about" is timezone-
 * relative and is resolved against the separate `timezone` field. This is the
 * one date-shaped field in this file that the feature schema does NOT override,
 * because it is already the server's representation.
 *
 * `timePreference` and `timezone` carry `.default(…)`s, so a parsed body always
 * contains them even when the caller omitted them.
 *
 * The backend schema lives in the CALENDAR feature
 * (`packages/features/src/calendar/services/check-availability`) because the
 * appointments controller delegates to `checkAvailability`; the contract lives
 * here because the ENDPOINT is `appointments/open-slots`.
 */
export const findOpenSlotsRequestBase = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  /** Preferred time of day for the appointment. */
  timePreference: z
    .enum(['morning', 'afternoon', 'evening', 'any'])
    .optional()
    .default('any'),
  /** Duration of appointment in minutes. */
  duration: z.number().int().min(15).max(480).optional(),
  /** Service type to check availability for (provider-specific). */
  serviceType: z.string().optional(),
  /** Service ID to filter by practitioners who offer this service. */
  serviceId: z.string().optional(),
  /** Timezone for the request (IANA format). */
  timezone: z.string().optional().default('UTC'),
});

/** `POST /appointments/open-slots` body — the VALIDATING half. */
export const findOpenSlotsRequestSchema = findOpenSlotsRequestBase.strict();

export type FindOpenSlotsRequest = z.infer<typeof findOpenSlotsRequestSchema>;
