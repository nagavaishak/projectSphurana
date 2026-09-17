/**
 * appointments / scheduling / deposits response PROJECTIONS — hand-composed from
 * generated atoms (see ./leads.ts for the pattern).
 *
 * Covers three related response surfaces:
 *  - appointments: entity, detail-with-relations, list wrapper.
 *  - deposits: entity, list wrapper, create/refund action responses.
 *  - scheduling: blocked-time (+ occurrence-expanded), blocked-time-types,
 *    time-off, shifts, resolved-shift-days (computed), wage config.
 *
 * All dates/times are ISO strings on the wire (the atoms are already wire-shaped).
 * Availability/slot and resolved-shift responses are COMPUTED (not tables), so
 * they are hand-written `z.object` projections, not atoms.
 */
import { z } from 'zod';
import {
  appointmentAtomSchema,
  appointmentDepositAtomSchema,
  appointmentServiceAtomSchema,
  blockedTimeAtomSchema,
  blockedTimeTypeAtomSchema,
  practitionerWageConfigAtomSchema,
  shiftAtomSchema,
  timeOffAtomSchema,
} from '../generated/index.js';

// ============================================================================
// APPOINTMENTS
// ============================================================================

/**
 * The appointment entity as stored — the atom verbatim, exposed under a contract
 * name so consumers depend on the contract, not the generated file.
 */
export const appointmentSchema = appointmentAtomSchema;
export type Appointment = z.infer<typeof appointmentSchema>;

/** Joined lead summary on an appointment (subset of the lead row). */
export const appointmentLeadSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  // Typed jsonb columns — hand-modeled here (atoms carry these as z.unknown()).
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  formData: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type AppointmentLead = z.infer<typeof appointmentLeadSchema>;

/** Joined assigned-user summary on an appointment. */
export const appointmentAssignedToSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
});
export type AppointmentAssignedTo = z.infer<typeof appointmentAssignedToSchema>;

/**
 * Joined PRIMARY-service summary on an appointment (the catalog row that
 * `appointment.serviceId` points at — line item 0). Distinct from the cart line
 * items below, which are `appointment_service` rows.
 */
export const appointmentPrimaryServiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  priceText: z.string().nullable(),
  appointmentDuration: z.number().nullable(),
  // NOTE: deliberately NOT `turnaroundMinutes`. This is a narrow display
  // summary of the joined catalog row; the query that builds it selects only
  // these columns, and turnaround is scheduling internals nothing here renders.
  // Adding it made every endpoint returning this projection fail response-
  // contract validation with a 500 — the clients list among them.
});
export type AppointmentPrimaryService = z.infer<
  typeof appointmentPrimaryServiceSchema
>;

/**
 * One cart line item — an `appointment_service` row verbatim (the generated
 * atom). The full cart is `services[]` on the appointment-with-relations
 * projection below.
 */
export const appointmentServiceSchema = appointmentServiceAtomSchema;
export type AppointmentService = z.infer<typeof appointmentServiceSchema>;

/**
 * The running cart total for an appointment. `isExact` is true only when every
 * line carries a price; otherwise `totalCents` is null and `fromCents` is the
 * sum of the known lines (Fresha's "from £X"). Mirrors `computeCartTotal` in
 * @borradh-workspace/features.
 */
export const appointmentCartTotalSchema = z.object({
  totalCents: z.number().nullable(),
  isExact: z.boolean(),
  fromCents: z.number().nullable(),
});
export type AppointmentCartTotal = z.infer<typeof appointmentCartTotalSchema>;

/**
 * The effective deposit summary attached to an appointment — the paid one if
 * present, else the latest. A trimmed projection of the deposit atom (status +
 * amount + paidAt) for the calendar's deposit badge / "Deposit paid €X" row.
 */
export const appointmentDepositSummarySchema = z.object({
  status: appointmentDepositAtomSchema.shape.status,
  amountCents: appointmentDepositAtomSchema.shape.amountCents,
  currency: appointmentDepositAtomSchema.shape.currency,
  paidAt: appointmentDepositAtomSchema.shape.paidAt,
});
export type AppointmentDepositSummary = z.infer<
  typeof appointmentDepositSummarySchema
>;

/**
 * `GET /appointments/:id` and list items — the appointment atom extended with
 * its (optional) joined lead, assigned user, primary service, and the full
 * multi-service cart (`services`).
 */
export const appointmentWithRelationsSchema = appointmentAtomSchema.extend({
  lead: appointmentLeadSchema.optional(),
  /**
   * NULLABLE, not merely optional.
   *
   * `appointment.assignedToId` is `onDelete: 'set null'` BY DESIGN — its schema
   * comment says removing a staff member must not cascade-delete their
   * (possibly historical/financial) appointments. So every appointment that
   * belonged to a departed staff member carries `assignedToId = NULL`, and
   * Drizzle's `with: { assignedTo: … }` then returns `assignedTo: null`.
   *
   * Declared `.optional()` only, parsing ANY such row threw — and it takes
   * down the WHOLE list response, not the one row. That is every organization
   * which has ever removed a team member. `service` and `deposit` two lines
   * below were already `.nullable().optional()`; `assignedTo` was the outlier.
   *
   * Found by executing the tool against a real Postgres row holding a real
   * NULL (`_integration/tool-appointments.int-spec.ts`). No static gate could
   * have found it: the GENERATED atom anchors column names, but `assignedTo`
   * is a JOIN, so its nullability was nobody's belief but the schema author's.
   */
  assignedTo: appointmentAssignedToSchema.nullable().optional(),
  service: appointmentPrimaryServiceSchema.nullable().optional(),
  services: z.array(appointmentServiceSchema).optional(),
  deposit: appointmentDepositSummarySchema.nullable().optional(),
});
export type AppointmentWithRelations = z.infer<
  typeof appointmentWithRelationsSchema
>;

/** `GET /appointments` — `{ items, total, limit, offset }` list wrapper. */
export const listAppointmentsResponseSchema = z.object({
  items: z.array(appointmentWithRelationsSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export type ListAppointmentsResponse = z.infer<
  typeof listAppointmentsResponseSchema
>;

// ============================================================================
// MANAGE BOOKING (public, token-authenticated — patient self-serve)
// ============================================================================

/**
 * The org's cancellation terms, as shown to the patient on the manage page.
 *
 * `lateFeeCents: null` means the org charges nothing — NOT zero. The UI must
 * render "free cancellation", never "€0.00 fee".
 */
export const cancellationPolicySchema = z.object({
  noticeRequiredHours: z.number(),
  isWithinFreeWindow: z.boolean(),
  lateFeeCents: z.number().nullable(),
});
export type CancellationPolicy = z.infer<typeof cancellationPolicySchema>;

/**
 * `GET /public/booking/:slug/manage/:token`.
 *
 * COMPUTED, and deliberately NOT the appointment atom. The token proves "I hold
 * this booking's link", which is weaker than "I am this client" — so this
 * projection exposes only what the holder already knows (what, when, with whom)
 * and never the lead record, internal notes, or org-internal appointment fields.
 * Widening it to `appointmentAtomSchema` would leak all three to an anonymous
 * caller.
 */
export const managedAppointmentSchema = z.object({
  appointmentId: z.string(),
  title: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  status: z.string(),
  /** False once the booking is terminal (completed/cancelled/no-show). */
  isActionable: z.boolean(),
  serviceName: z.string().nullable(),
  practitionerName: z.string().nullable(),
  /** Drive the reschedule picker off the same public slots endpoint. */
  serviceId: z.string().nullable(),
  practitionerId: z.string().nullable(),
  /** The BOOKED duration, not the service's current one. */
  durationMinutes: z.number(),
  organization: z.object({
    name: z.string(),
    slug: z.string(),
    logo: z.string().nullable(),
    timezone: z.string(),
  }),
  policy: cancellationPolicySchema,
});
export type ManagedAppointment = z.infer<typeof managedAppointmentSchema>;

/** `POST /public/booking/:slug/manage/:token/cancel`. */
export const cancelManagedAppointmentResponseSchema = z.object({
  appointmentId: z.string(),
  /** The terms as they stood at the moment of cancellation. */
  policyAtCancellation: cancellationPolicySchema,
});
export type CancelManagedAppointmentResponse = z.infer<
  typeof cancelManagedAppointmentResponseSchema
>;

/** `POST /public/booking/:slug/manage/:token/reschedule`. */
export const rescheduleManagedAppointmentResponseSchema = z.object({
  appointmentId: z.string(),
  startDate: z.string(),
  endDate: z.string(),
});
export type RescheduleManagedAppointmentResponse = z.infer<
  typeof rescheduleManagedAppointmentResponseSchema
>;

// ============================================================================
// DEPOSITS
// ============================================================================

/** The appointment-deposit entity — the atom verbatim. */
export const depositSchema = appointmentDepositAtomSchema;
export type Deposit = z.infer<typeof depositSchema>;

/** `GET /deposits` — list wrapper. */
export const listDepositsResponseSchema = z.object({
  items: z.array(depositSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export type ListDepositsResponse = z.infer<typeof listDepositsResponseSchema>;

/** Response when creating a deposit request (deposit + Stripe checkout link). */
export const createDepositResponseSchema = z.object({
  deposit: depositSchema,
  checkoutUrl: z.string(),
});
export type CreateDepositResponse = z.infer<typeof createDepositResponseSchema>;

/** Response when refunding a deposit (updated deposit + Stripe refund id). */
export const refundDepositResponseSchema = z.object({
  deposit: depositSchema,
  refundId: z.string(),
});
export type RefundDepositResponse = z.infer<typeof refundDepositResponseSchema>;

// ============================================================================
// SCHEDULING — blocked time
// ============================================================================

/** A blocked-time type (preset) — the atom verbatim. */
export const blockedTimeTypeSchema = blockedTimeTypeAtomSchema;
export type BlockedTimeType = z.infer<typeof blockedTimeTypeSchema>;

/** A blocked-time series row — the atom verbatim. */
export const blockedTimeSchema = blockedTimeAtomSchema;
export type BlockedTime = z.infer<typeof blockedTimeSchema>;

/**
 * `GET /blocked-time` — occurrence-EXPANDED blocked times. Recurring series are
 * expanded into per-occurrence rows: `startDate`/`endDate` are the occurrence
 * dates, `blockedTimeId` points at the parent series, and `originalStart`
 * (RECURRENCE-ID, an ISO string on the wire) identifies the occurrence for
 * scope='this'/'following' edits. `practitionerIds` empty = org-wide block.
 */
export const blockedTimeWithPractitionersSchema = blockedTimeAtomSchema.extend({
  practitionerIds: z.array(z.string()),
  blockedTimeId: z.string().optional(),
  originalStart: z.string().datetime().optional(),
});
export type BlockedTimeWithPractitioners = z.infer<
  typeof blockedTimeWithPractitionersSchema
>;

/** `GET /blocked-time` returns a bare array of expanded occurrences. */
export const listBlockedTimeResponseSchema = z.array(
  blockedTimeWithPractitionersSchema
);
export type ListBlockedTimeResponse = z.infer<
  typeof listBlockedTimeResponseSchema
>;

/** `GET /blocked-time-types` returns a bare array of presets. */
export const listBlockedTimeTypesResponseSchema = z.array(
  blockedTimeTypeSchema
);
export type ListBlockedTimeTypesResponse = z.infer<
  typeof listBlockedTimeTypesResponseSchema
>;

// ============================================================================
// SCHEDULING — time off
// ============================================================================

/** A time-off series row — the atom verbatim. */
export const timeOffSchema = timeOffAtomSchema;
export type TimeOff = z.infer<typeof timeOffSchema>;

/** `GET /time-off` returns a bare array of (occurrence-expanded) time-off rows. */
export const listTimeOffResponseSchema = z.array(timeOffSchema);
export type ListTimeOffResponse = z.infer<typeof listTimeOffResponseSchema>;

// ============================================================================
// SCHEDULING — shifts (raw rows + computed resolved days)
// ============================================================================

/** A raw shift row (weekly pattern or date override) — the atom verbatim. */
export const shiftSchema = shiftAtomSchema;
export type Shift = z.infer<typeof shiftSchema>;

/** One resolved working interval on a resolved shift day. COMPUTED, not a table. */
export const resolvedShiftIntervalSchema = z.object({
  shiftId: z.string(),
  startMinutes: z.number(),
  endMinutes: z.number(),
  locationId: z.string().nullable(),
});
export type ResolvedShiftInterval = z.infer<typeof resolvedShiftIntervalSchema>;

/**
 * `GET /shifts` item — the resolved schedule for one practitioner on one date,
 * with date overrides applied over the weekly pattern. COMPUTED (not a table):
 * `date` is a YYYY-MM-DD string, `dayOfWeek` is 0=Sun..6=Sat.
 */
export const resolvedShiftDaySchema = z.object({
  practitionerId: z.string(),
  date: z.string(),
  dayOfWeek: z.number(),
  isOff: z.boolean(),
  source: z.enum(['weekly', 'override']),
  intervals: z.array(resolvedShiftIntervalSchema),
});
export type ResolvedShiftDay = z.infer<typeof resolvedShiftDaySchema>;

/** `GET /shifts` returns a bare array of resolved shift days. */
export const listShiftsResponseSchema = z.array(resolvedShiftDaySchema);
export type ListShiftsResponse = z.infer<typeof listShiftsResponseSchema>;

// ============================================================================
// SCHEDULING — wage config
// ============================================================================

/** `GET /wage-configs/:practitionerId` — the wage-config atom verbatim. */
export const practitionerWageConfigSchema = practitionerWageConfigAtomSchema;
export type PractitionerWageConfig = z.infer<
  typeof practitionerWageConfigSchema
>;
