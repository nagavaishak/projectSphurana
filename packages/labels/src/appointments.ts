/**
 * Appointment enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Appointment status labels.
//
// `held` is APPENDED, not slotted into lifecycle order: `appointmentStatusValues`
// is `Object.keys(...)`, so position determines the Postgres enum's value order
// and inserting mid-record would rewrite it.
export const appointmentStatusLabels = {
  booked: 'Booked',
  confirmed: 'Confirmed',
  arrived: 'Arrived',
  started: 'Started',
  completed: 'Completed',
  no_show: 'No Show',
  cancelled: 'Cancelled',
  held: 'Held',
} as const;

/**
 * Statuses that count as an "active booking" — used by overlap checks,
 * availability computation, and reminders. Anything else (completed, no_show,
 * cancelled) does not block a slot.
 *
 * `held` is active on purpose: a hold that did not block the slot would let a
 * second customer book over it, which is the entire point of holding.
 */
export const activeAppointmentStatuses = [
  'booked',
  'confirmed',
  'arrived',
  'started',
  'held',
] as const satisfies readonly (keyof typeof appointmentStatusLabels)[];

/**
 * Statuses whose slot is reserved but unpaid, and which `expireAppointmentHolds`
 * releases once `appointment.holdExpiresAt` passes.
 *
 * A hold reaches `confirmed` by being paid, `booked` by a staff member keeping
 * it, or `cancelled` by expiring.
 */
export const heldAppointmentStatuses = [
  'held',
] as const satisfies readonly (keyof typeof appointmentStatusLabels)[];

export const appointmentStatusValues = Object.keys(appointmentStatusLabels) as [
  keyof typeof appointmentStatusLabels,
  ...(keyof typeof appointmentStatusLabels)[],
];

export type AppointmentStatus = keyof typeof appointmentStatusLabels;

// Appointment source labels
export const appointmentSourceLabels = {
  manual: 'Manual',
  ai_voice_caller: 'AI Voice Caller',
  calendar_sync: 'Calendar Sync',
  booking_form: 'Booking Form',
} as const;

export const appointmentSourceValues = Object.keys(appointmentSourceLabels) as [
  keyof typeof appointmentSourceLabels,
  ...(keyof typeof appointmentSourceLabels)[],
];

export type AppointmentSource = keyof typeof appointmentSourceLabels;

// Appointment color labels
export const appointmentColorLabels = {
  blue: 'Blue',
  green: 'Green',
  red: 'Red',
  yellow: 'Yellow',
  purple: 'Purple',
  orange: 'Orange',
} as const;

export const appointmentColorValues = Object.keys(appointmentColorLabels) as [
  keyof typeof appointmentColorLabels,
  ...(keyof typeof appointmentColorLabels)[],
];

export type AppointmentColor = keyof typeof appointmentColorLabels;

/**
 * ── Appointment duration: the ONE resolution rule (ENG-793) ─────────────────
 *
 * A service's length is `organization_service.appointment_duration`. That column
 * is nullable, so every booking path needs a fallback — and each one used to
 * pick its own. The public booking page generated 30-minute slots
 * (`DEFAULT_SLOT_DURATION`), the staff calendar built 60-minute blocks
 * (`DEFAULT_APPOINTMENT_DURATION_MINUTES`), the confirmation email said 30, and
 * a cart line item contributed 0. The same Haircut was therefore 30 minutes to
 * a customer and 60 to the clinic, which is exactly the divergence in
 * availability, capacity and expectation ENG-793 reports.
 *
 * The canonical ladder is:
 *
 *     service.appointmentDuration → organization.defaultAppointmentDuration → 30
 *
 * The middle rung is not new: `organization.default_appointment_duration`
 * already exists (DEFAULT 30) and the chatbot, voice and
 * `calendar/book-appointment` paths already resolve through it. The public
 * booking page and the staff calendar were the two that did not. So this helper
 * does not invent a policy — it makes the two outliers agree with the four
 * paths that were already right, and gives every future path one function to
 * call instead of a fresh literal.
 *
 * Lives in `labels` because it must be callable from the pure frontend
 * (apps/app, apps/marketing-astro) AND from the features package, and labels is
 * the only dependency-free package all three already import.
 */

/**
 * Last-resort length when neither the service nor the organization configures
 * one. Matches the `organization.default_appointment_duration` column default,
 * so an org row written before that column existed resolves the same as one
 * written after it.
 */
export const FALLBACK_APPOINTMENT_DURATION_MINUTES = 30;

/**
 * Coerce a duration-ish value to a usable positive minute count, or `undefined`
 * when it carries no information.
 *
 * The `string` case is real rather than defensive: the staff calendar reads the
 * duration off a service object that has been through JSON, where a numeric
 * column can arrive as `"45"`.
 */
const toPositiveMinutes = (
  value?: number | string | null
): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : undefined;
};

/**
 * Resolve the canonical length of an appointment, in minutes.
 *
 * Both arguments accept the nullable/undefined shapes the callers actually
 * hold (a Drizzle column is `number | null`; an unloaded org is `undefined`),
 * and non-positive or non-finite values are treated as unset rather than
 * producing a zero-length appointment.
 *
 * @param serviceDuration `organization_service.appointment_duration`
 * @param organizationDefault `organization.default_appointment_duration`
 */
export const resolveAppointmentDuration = (
  serviceDuration?: number | string | null,
  organizationDefault?: number | string | null
): number =>
  toPositiveMinutes(serviceDuration) ??
  toPositiveMinutes(organizationDefault) ??
  FALLBACK_APPOINTMENT_DURATION_MINUTES;
