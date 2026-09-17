import {
  type Appointment,
  type ListAppointmentsResponse,
  appointmentSchema,
  listAppointmentsResponseSchema,
  organizationServiceSchema,
} from '@borradh-workspace/contracts';
import type { AppointmentStatus } from '@borradh-workspace/labels';
import { z } from 'zod';
import type { ApiFetchFn } from '../../tool-factory/api-fetch.js';
import { defineTool } from '../../tool-factory/index.js';
import { resolveToolDateTime } from '../_shared/resolve-tool-date.js';
import { APPOINTMENTS_PATH_PATTERNS } from './paths.js';

interface BookAppointmentOutput {
  appointmentId: string;
  appointment: Appointment;
}

/**
 * Slim projection of the service lookup for the deposit guardrail — only the
 * two fields the guardrail reads, picked from the real service contract so the
 * names cannot drift from the column names.
 */
const serviceDepositLookupSchema = organizationServiceSchema.pick({
  requiresDeposit: true,
  depositAmountCents: true,
});
type ServiceDepositLookup = z.infer<typeof serviceDepositLookupSchema>;

/** Slim shape of a listed appointment for the double-booking guardrail. */
interface OverlapAppointment {
  id: string;
  startDate: string;
  endDate: string;
  status: AppointmentStatus;
  practitionerId: string | null;
}

const ACTIVE_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  'booked',
  'confirmed',
  'arrived',
  'started',
]);

/** Minimal shape of the tool context the guardrail lookups need. */
interface GuardrailCtx {
  /**
   * The REAL `ApiFetchFn`, not a local re-declaration.
   *
   * This used to declare its own narrowed `<T>(path, init) => Promise<T>`,
   * which structurally satisfied the call sites while silently dropping the
   * `schema` overload — so a guardrail lookup could not parse its response
   * even after `apiFetch` learned how. A local restatement of a shared
   * signature is drift waiting to happen.
   */
  apiFetch: ApiFetchFn;
}

/**
 * Deposit guardrail lookup. Reads whether the booked service requires a
 * deposit. Fails open (returns null) — a lookup error must never block a
 * booking; the model's own `depositRequired` flag and the prompt rule remain.
 */
async function lookupServiceDeposit(
  serviceId: string,
  ctx: GuardrailCtx
): Promise<ServiceDepositLookup | null> {
  try {
    return await ctx.apiFetch(`organization-services/${serviceId}`, {
      schema: serviceDepositLookupSchema,
    });
  } catch {
    return null;
  }
}

/**
 * Double-booking guardrail lookup. Returns the first existing ACTIVE
 * appointment for the same practitioner whose time overlaps the proposed slot,
 * or null. Widen the query window backwards so an appointment that STARTS
 * before the new slot but ends inside it is still caught, then filter to true
 * time-overlap client-side. Fails open on any error.
 */
async function findOverlap(
  input: { startDate: string; endDate: string; practitionerId?: string },
  ctx: GuardrailCtx
): Promise<OverlapAppointment | null> {
  if (!input.practitionerId) return null;
  const newStart = Date.parse(input.startDate);
  const newEnd = Date.parse(input.endDate);
  if (Number.isNaN(newStart) || Number.isNaN(newEnd)) return null;

  // 12h back-window comfortably covers any single appointment's duration.
  const windowStart = new Date(newStart - 12 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(newEnd).toISOString();
  const params = new URLSearchParams({
    startDateFrom: windowStart,
    startDateTo: windowEnd,
    limit: '100',
  });

  let response: ListAppointmentsResponse;
  try {
    response = await ctx.apiFetch(`appointments?${params.toString()}`, {
      schema: listAppointmentsResponseSchema,
    });
  } catch {
    return null;
  }

  for (const appt of response.items ?? []) {
    if (appt.practitionerId !== input.practitionerId) continue;
    if (!ACTIVE_STATUSES.has(appt.status)) continue;
    const start = Date.parse(appt.startDate);
    const end = Date.parse(appt.endDate);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    // True overlap: existing starts before new ends AND ends after new starts.
    if (start < newEnd && end > newStart) return appt;
  }
  return null;
}

type AppointmentColor =
  | 'blue'
  | 'green'
  | 'red'
  | 'yellow'
  | 'purple'
  | 'orange';

interface BookAppointmentInput {
  /** Customer (must already exist as a lead). */
  leadId: string;
  /** Display title — usually `<service> with <practitioner>`. */
  title: string;
  /** Optional notes captured on the appointment record. */
  description?: string;
  /** ISO datetime for slot start. */
  startDate: string;
  /** ISO datetime for slot end. */
  endDate: string;
  /** Optional appointment color for calendar display. Defaults server-side
   *  to 'blue'. */
  color?: AppointmentColor;
  /** Optional practitioner. The underlying service prefers practitioner's
   *  calendar when provided; falls back to org's primary calendar. */
  practitionerId?: string;
  /** Optional staff member assignment. Defaults server-side to current user. */
  assignedToId?: string;
  /** For confirmation summary display only — surfaced back to the operator. */
  customerDisplayName?: string;
  /** For confirmation summary display only. */
  serviceDisplayName?: string;
  /** Service being booked. When set, the deposit guardrail looks up whether
   *  this service requires a deposit and surfaces it even if the model didn't
   *  set `depositRequired`. */
  serviceId?: string;
  /** Operator should know the customer will receive a deposit payment link.
   *  Surfaced in the confirmation summary; the booking system handles the
   *  actual deposit collection downstream. */
  depositRequired?: boolean;
  /** Echoed on the second call. */
  confirmationToken?: string;
}

/**
 * `appointments_bookAppointment` — book an appointment on behalf of a lead.
 *
 * Wraps `POST /appointments`. Two-call confirmation flow:
 *   1. First call (no confirmationToken) — factory issues a token + summary.
 *   2. Second call (with confirmationToken) — factory verifies, then this
 *      `execute` runs and creates the appointment.
 *
 * The confirmation summary surfaces customer/service/practitioner/slot/
 * deposit so the operator approves with full context.
 */
export const bookAppointmentTool = defineTool<
  BookAppointmentInput,
  BookAppointmentOutput
>({
  feature: 'appointments',
  action: 'bookAppointment',
  description:
    'Book an appointment for a lead. Requires the leadId, title, startDate, ' +
    'endDate (ISO), and optionally practitionerId. The customer must ' +
    'already exist as a lead. Confirmation is required before the booking ' +
    'is created — the operator sees customer, slot, practitioner, service, ' +
    'and deposit-required flag.',
  inputSchema: z.object({
    leadId: z.string().min(1).describe('ID of the lead being booked.'),
    title: z
      .string()
      .min(1)
      .describe(
        'Appointment title — typically "<service> with <practitioner>".'
      ),
    description: z
      .string()
      .optional()
      .describe('Free-text notes attached to the appointment record.'),
    startDate: z
      .string()
      .min(1)
      .describe(
        'Slot start. Prefer the exact ISO datetime from a prior findOpenSlots ' +
          'call. If the user gave words ("tomorrow 2pm"), pass them verbatim — ' +
          'the server resolves them against the real clock in the org timezone. ' +
          'Do NOT compute a date yourself.'
      ),
    endDate: z
      .string()
      .min(1)
      .describe(
        'Slot end. Prefer the exact ISO datetime from findOpenSlots. Relative ' +
          'phrases are resolved server-side in the org timezone. Do NOT compute ' +
          'a date yourself.'
      ),
    color: z
      .enum(['blue', 'green', 'red', 'yellow', 'purple', 'orange'])
      .optional()
      .describe(
        'Optional calendar color for the appointment. Defaults to "blue" server-side.'
      ),
    practitionerId: z
      .string()
      .optional()
      .describe('Optional practitioner. When set, uses their calendar.'),
    assignedToId: z
      .string()
      .optional()
      .describe(
        'Optional staff user assignment. Defaults to the chat user server-side.'
      ),
    customerDisplayName: z
      .string()
      .optional()
      .describe(
        "Customer display name — shown in the confirmation summary only. The lead's record is the source of truth."
      ),
    serviceDisplayName: z
      .string()
      .optional()
      .describe('Service name — shown in the confirmation summary only.'),
    serviceId: z
      .string()
      .optional()
      .describe(
        'ID of the service being booked. When set, the deposit guardrail ' +
          'checks whether the service requires a deposit and surfaces it. ' +
          'Get it from listServices.'
      ),
    depositRequired: z
      .boolean()
      .optional()
      .describe(
        'When true, the confirmation summary tells the operator the customer will be sent a deposit payment link.'
      ),
    confirmationToken: z
      .string()
      .optional()
      .describe(
        'Echoed on the second call to confirm the booking. The first call returns a token; the second call passes it back along with the same input.'
      ),
  }),
  destructive: true,
  destructiveAction: 'book_appointment',
  preferredModel: 'sonnet',
  presentation: {
    statusLabel: 'Booking the appointment',
    confirmationRenderer: 'appointment-confirmation',
  },
  // Shared appointments patterns + a read-only service lookup for the deposit
  // guardrail. A fresh array — never mutate the shared APPOINTMENTS_PATH_PATTERNS.
  additionalAllowedPaths: [
    ...APPOINTMENTS_PATH_PATTERNS,
    /^organization-services\/[a-zA-Z0-9_-]+$/,
  ],
  summarizeForConfirmation: async (input, ctx) => {
    // Phase 3: resolve any date EXPRESSIONS server-side (org timezone, real
    // clock) so the operator confirms against the ABSOLUTE slot and the
    // overlap guardrail runs on real instants. Absolute ISO passes through.
    const startDate = resolveToolDateTime(
      input.startDate,
      ctx.timezone,
      'start'
    );
    const endDate = resolveToolDateTime(input.endDate, ctx.timezone, 'start');

    const fields: { label: string; value: string }[] = [];
    fields.push({
      label: 'Customer',
      value: input.customerDisplayName ?? `Lead ${input.leadId}`,
    });
    if (input.serviceDisplayName) {
      fields.push({ label: 'Service', value: input.serviceDisplayName });
    }
    fields.push({ label: 'Title', value: input.title });
    if (input.practitionerId) {
      fields.push({ label: 'Practitioner', value: input.practitionerId });
    }
    fields.push({ label: 'Start', value: startDate });
    fields.push({ label: 'End', value: endDate });

    // ── Guardrail 1: double-booking ─────────────────────────────────────────
    // Warn (don't block) when the chosen slot overlaps an existing active
    // appointment for this practitioner. A deliberate double-book is allowed,
    // but never silent. Fail-open: a lookup hiccup must not block a booking.
    const overlap = await findOverlap({ ...input, startDate, endDate }, ctx);
    if (overlap) {
      fields.push({
        label: '⚠ Double-booking',
        value: `Overlaps an existing ${overlap.status} appointment for this practitioner (${overlap.startDate} → ${overlap.endDate}). This will double-book them.`,
      });
    }

    // ── Guardrail 2: deposit ────────────────────────────────────────────────
    // Surface a required deposit even if the model forgot to set the flag.
    // Trust the model's flag first; otherwise look the service up.
    let depositRequired = input.depositRequired ?? false;
    let depositAmountCents: number | null = null;
    if (!depositRequired && input.serviceId) {
      const service = await lookupServiceDeposit(input.serviceId, ctx);
      if (service?.requiresDeposit) {
        depositRequired = true;
        depositAmountCents = service.depositAmountCents ?? null;
      }
    }
    if (depositRequired) {
      fields.push({
        label: 'Deposit',
        value: depositAmountCents
          ? `Required — €${(depositAmountCents / 100).toFixed(2)}. The customer will receive a payment link from the booking system.`
          : 'Required — the customer will receive a payment link from the booking system.',
      });
    }
    return {
      title: 'Book appointment',
      fields,
      // Booking is a creation — there's no appointment id yet. The factory
      // calls `inferResourceId(input)` on the second call, which picks
      // `leadId` out of the input. Use the same value here so the verify
      // step matches. Slot uniqueness (lead + start + end) is enforced by
      // the payload-mismatch check on the second call.
      resourceId: input.leadId,
      payload: {
        leadId: input.leadId,
        startDate: input.startDate,
        endDate: input.endDate,
        practitionerId: input.practitionerId,
      },
    };
  },
  execute: async (input, ctx) => {
    // Resolve expressions against the real clock in the org timezone. Absolute
    // ISO from findOpenSlots passes through unchanged; unresolvable →
    // ApiFetchError(400) whose message quotes today so the model self-corrects.
    const startDate = resolveToolDateTime(
      input.startDate,
      ctx.timezone,
      'start'
    );
    const endDate = resolveToolDateTime(input.endDate, ctx.timezone, 'start');
    const body = {
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      startDate,
      endDate,
      leadId: input.leadId,
      ...(input.color ? { color: input.color } : {}),
      ...(input.assignedToId ? { assignedToId: input.assignedToId } : {}),
      ...(input.practitionerId ? { practitionerId: input.practitionerId } : {}),
    };
    const created = await ctx.apiFetch('appointments', {
      method: 'POST',
      body,
      schema: appointmentSchema,
    });
    return {
      data: {
        appointmentId: created.id,
        appointment: created,
      },
    };
  },
});
