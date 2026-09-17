import {
  appointmentServiceLineRequestBase,
  createAppointmentRequestBase,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { zId, zonedDateString } from '../../../shared/index.js';

/**
 * Time-correctness backstop grace (Phase 3).
 *
 * This guards ONE failure mode: a date-blind model resolving "tomorrow"
 * against its training prior and landing roughly a YEAR in the past
 * (register #208). It is deliberately NOT a business rule about how far back
 * an operator may book — the calendar UI has no min-date on its picker and
 * back-entering a walk-in or no-show from a previous week is a supported
 * flow, so a tight window would reject legitimate human input (and surface an
 * LLM-worded error to a human operator).
 *
 * 180 days comfortably admits any realistic back-entry while still catching
 * the ~12-month misresolution the backstop exists for.
 */
const PAST_BOOKING_GRACE_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * One line item in the appointment's "cart" (Fresha multi-service booking).
 *
 * DERIVED from the canonical wire contract
 * (`appointmentServiceLineRequestBase`): the snapshot fields
 * (`name` / `durationMinutes` / `priceCents`), `serviceId` and `variantId` and
 * their validation all live there. The only thing added here is the BRAND on
 * `practitionerId` — a server-side type-safety device (see shared/branded.ts),
 * not a wire constraint, so it cannot live in the dependency-pure contracts
 * package.
 */
export const createAppointmentServiceLineSchema =
  appointmentServiceLineRequestBase.extend({
    practitionerId: zId<'Practitioner'>().optional(),
  });
export type CreateAppointmentServiceLine = z.input<
  typeof createAppointmentServiceLineSchema
>;

/**
 * Base schema without refinements (for DTOs with createZodDto).
 *
 * DERIVED from the canonical wire contract (`createAppointmentRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected context onto
 * it, so the server can never be laxer than what the client is told to send.
 * Field rules (`.min(1)`, the enums, the `.default(…)`s) live in the contract;
 * do not restate them here.
 *
 * Three keys are re-typed rather than added:
 *  - `startDate` / `endDate` — the wire carries ISO STRINGS; the service wants
 *    `Date`s, so the parsed representation is coerced here. Optionality still
 *    comes from the contract (`endDate` optional when a `services` cart derives
 *    it), and `z.coerce.date()` accepts exactly the strings the contract admits.
 *  - `assignedToId` / `practitionerId` / `services[].practitionerId` — branded
 *    ids, as above. Input stays `string`, so DTOs and controllers keep passing
 *    plain strings.
 */
export const createAppointmentBaseSchema = createAppointmentRequestBase.extend({
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  holdExpiresAt: z.coerce.date().optional().nullable(),
  // Branded IDs (see shared/branded.ts): `assignedToId` is a UserId and
  // `practitionerId` a PractitionerId, so the two can no longer be crossed.
  assignedToId: zId<'User'>().optional(), // Defaults to current user in controller
  practitionerId: zId<'Practitioner'>().optional(),
  services: z.array(createAppointmentServiceLineSchema).optional(),
  organizationId: z.string().min(1, 'Organization ID is required'),
  /**
   * Explicit rooms/equipment for this booking (front desk picking the room
   * itself, or an org on `resource_assignment_mode: 'manual'`). Omitted ⇒ the
   * system auto-assigns from the required categories; an org with no resource
   * requirements ignores this entirely.
   *
   * Additive and optional: every existing caller keeps working untouched.
   */
  resourceIds: z.array(z.string().min(1)).optional(),
  /**
   * The front desk was shown the clash and chose to book anyway.
   *
   * Only meaningful with `resourceIds`, and honoured only for CONSOLE
   * bookings — the service drops it for anything coming from the public
   * booking page, chatbot or voice agent. Overbooking a room is a judgement a
   * person standing in the clinic can make; a customer cannot.
   */
  allowResourceOverbook: z.boolean().optional(),
  /**
   * The branch the appointment happens at. Server-injected from the validated
   * `X-Location-Id` header, not a wire field — which is why it is added here
   * rather than in the contract.
   *
   * Serves TWO purposes, and they arrived from different directions: it is
   * STORED on the appointment (the branch calendar reads it), and it filters
   * resource allocation so a room pinned to another branch is never handed to
   * a booking at this one. A resource with no location is available
   * everywhere, mirroring how null-location shift rows already behave.
   *
   * STAYS OPTIONAL ON INPUT, deliberately. Three writers legitimately have no
   * header to inject from — voice bookings, Claire's direct booking and the
   * API-key `POST /v1/appointments` — and requiring it here would only move
   * the failure from a silently-invisible row to a rejected customer booking.
   * `createAppointment` closes the gap instead: when this is absent it falls
   * back to `resolveDefaultLocation` before the insert, so no writer can
   * produce a NULL for an org that has any location at all. The allocator is
   * given that RESOLVED branch, not this raw input — otherwise every booking
   * that relied on the fallback would allocate rooms unfiltered.
   *
   * It cannot be made non-optional on the OUTPUT side either: an org with
   * zero locations still resolves to null (see the branch-stamping block in
   * the service for why that must not throw). Once the column itself is
   * tightened — which requires every org to have a location — this becomes
   * required.
   */
  locationId: z.string().min(1).nullable().optional(),
});

// Full schema with refinements (for service validation)
// Service requires assignedToId - controller provides it from session user
export const createAppointmentSchema = createAppointmentBaseSchema
  .extend({
    assignedToId: zId<'User'>(),
  })
  // Need an end for the appointment: either an explicit endDate OR a non-empty
  // cart to derive it from. (Mirrored on `createAppointmentRequestSchema` — the
  // strict wire half — because a `.refine()` cannot be carried across
  // `.extend()`.)
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
    (data) => data.endDate === undefined || data.endDate > data.startDate,
    {
      message: 'End date must be after start date',
      path: ['endDate'],
    }
  )
  // Time-correctness backstop (Claire reliability overhaul, Phase 3 —
  // register #208: a booking was attempted for a date a full year in the past
  // because the model resolved "tomorrow" against its training prior).
  // See `PAST_BOOKING_GRACE_MS` for why the window is wide: this catches a
  // misresolved YEAR, not legitimate back-entry. The message quotes today's
  // date so a model seeing the structured error can self-correct in-turn.
  .superRefine((data, ctx) => {
    const now = new Date();
    if (data.startDate.getTime() < now.getTime() - PAST_BOOKING_GRACE_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startDate'],
        message: `startDate (${data.startDate.toISOString()}) is more than 180 days in the past — today is ${zonedDateString(now, 'UTC')} (UTC). Check the year: re-resolve the date from today's date and try again.`,
      });
    }
  });

// Input type (what callers provide - optional fields are optional)
export type CreateAppointmentInput = z.input<typeof createAppointmentSchema>;

// Output type (after defaults applied - all fields present)
export type CreateAppointmentParsed = z.output<typeof createAppointmentSchema>;
