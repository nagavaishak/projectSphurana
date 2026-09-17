import { format, parse } from 'date-fns';
import { z } from 'zod';

import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { zonedWallTimeToUtc } from '@/lib/timezone';
import type {
  AppointmentColor,
  CreateAppointmentInput,
} from '@borradh-workspace/api-client/types';
import {
  FALLBACK_APPOINTMENT_DURATION_MINUTES,
  resolveAppointmentDuration,
} from '@borradh-workspace/labels';

/**
 * SHARED CORE — appointment creation.
 *
 * ONE `defineForm` declaration and ONE payload builder for every surface that
 * creates an appointment (the desktop dialog and the two mobile funnels).
 * Nothing else in the app may hand-build a `POST /appointments` body — see the
 * form contract (`create-appointment.contract.test.tsx`), which drives all three
 * surfaces through their real UI and pins them to the exact same output.
 */

/**
 * Fallback length (minutes) when neither the chosen service nor the
 * organization configures one.
 *
 * Re-exported from the shared vocabulary rather than declared here. This
 * constant used to be a local `60` while the public booking page used a local
 * `30`, so the same null-duration service produced a 60-minute staff block and
 * a 30-minute customer slot (ENG-793). There is now one ladder —
 * service → org default → 30 — in `resolveAppointmentDuration`.
 */
export const DEFAULT_APPOINTMENT_DURATION_MINUTES =
  FALLBACK_APPOINTMENT_DURATION_MINUTES;

/** Fallback tint when the assigned practitioner has no color set. */
export const DEFAULT_APPOINTMENT_COLOR: AppointmentColor = 'blue';

/**
 * Sentinel for "no specific team member" in the mobile practitioner step.
 * Stripped by the payload builder (the key is omitted entirely), matching a
 * desktop slot that has no practitioner column.
 */
export const APPOINTMENT_NO_PRACTITIONER = 'none';

/**
 * The form, declared once: schema + label + control + default per key. The JSX
 * renders `appointmentCreateForm.labels.x` rather than a literal, so a control
 * deleted from a surface has nowhere to hide — the contract's locator misses it.
 *
 * The controls named here are the DESKTOP dialog's (a Select for the service and
 * the team member, an `<input type="time">`, a popover DatePicker). The mobile
 * funnels reach the same fields through their own controls — a full-screen
 * client list, a service list, practitioner pills, a time sheet — so their
 * surfaces in the contract carry their own fills. Both still locate a REAL
 * control and still fail loudly when one is missing.
 */
export const appointmentCreateForm = defineForm({
  fields: {
    leadId: {
      schema: z.string().min(1, 'Client is required'),
      label: 'Client',
      control: 'custom',
      default: '',
      sample: 'lead-1',
    },
    serviceId: {
      schema: z.string().min(1, 'Service is required'),
      label: 'Service',
      control: 'select',
      default: '',
      sample: 'svc-1',
      sampleLabel: 'Balayage',
    },
    /** Optional; `APPOINTMENT_NO_PRACTITIONER` means "unassigned". */
    practitionerId: {
      schema: z.string().optional(),
      label: 'Team member',
      control: 'select',
      default: '',
      sample: 'prac-1',
      sampleLabel: 'Sam',
    },
    /** yyyy-MM-dd, wall-clock in the business timezone → folded into startDate. */
    date: {
      schema: z.string().min(1, 'Date is required'),
      label: 'Date',
      control: 'custom',
      default: '',
      sample: '2026-03-05',
      derived: true,
    },
    /** HH:mm, wall-clock in the business timezone → folded into startDate. */
    startTime: {
      schema: z.string().min(1, 'Start time is required'),
      label: 'Start time',
      control: 'time',
      default: '',
      sample: '09:30',
      derived: true,
    },
    /** Free text → the appointment's `description`. */
    notes: {
      schema: z.string().optional(),
      label: 'Notes',
      control: 'textarea',
      default: '',
      sample: 'Allergic to latex',
      derived: true,
    },
  },
});

export const appointmentCreateSchema = appointmentCreateForm.schema;
export const appointmentCreateFields = appointmentCreateForm.fields;
export const appointmentCreateDefaultValues = appointmentCreateForm.defaults;

export type AppointmentCreateFormData = InferFormValues<
  typeof appointmentCreateForm
>;

/** Minimal shape the core needs off a service. */
export interface AppointmentCreateService {
  id: string;
  name: string;
  appointmentDuration?: number | string | null;
}

/** Minimal shape the core needs off a practitioner. */
export interface AppointmentCreatePractitioner {
  id: string;
  name: string;
  color?: string | null;
}

export interface AppointmentCreateContext {
  services: AppointmentCreateService[];
  practitioners: AppointmentCreatePractitioner[];
  /** organization.timezone — the business timezone the picked wall-clock is in. */
  timeZone: string;
  /**
   * `organization.defaultAppointmentDuration` — the clinic-wide length used for
   * a service that configures none. The SAME rung the public booking page,
   * the chatbot and the voice agent resolve through, which is what stops the
   * staff calendar and the booking page disagreeing (ENG-793).
   */
  defaultAppointmentDuration?: number | null;
}

/**
 * The service's own length; never snapped to buckets.
 *
 * Falls through the shared ladder when the service has no duration, so a
 * booking made here is the same length as one made from the public page.
 */
export function resolveAppointmentDurationMinutes(
  service: AppointmentCreateService | undefined,
  organizationDefault?: number | null
): number {
  return resolveAppointmentDuration(
    service?.appointmentDuration,
    organizationDefault
  );
}

/** Normalise the optional practitioner selection to an id or `undefined`. */
export function resolveAppointmentPractitionerId(
  value: string | undefined
): string | undefined {
  if (!value || value === APPOINTMENT_NO_PRACTITIONER) return undefined;
  return value;
}

/**
 * THE ONLY place a create-appointment API payload is constructed.
 *
 * - title  — auto-derived from the chosen service (never typed by the user)
 * - color  — derived from the assigned practitioner's calendar tint
 * - end    — start + the service's exact `appointmentDuration`
 * - start  — the picked wall-clock resolved in the BUSINESS timezone
 */
export function buildCreateAppointmentPayload(
  values: AppointmentCreateFormData,
  context: AppointmentCreateContext
): CreateAppointmentInput {
  const service = context.services.find((s) => s.id === values.serviceId);
  const practitionerId = resolveAppointmentPractitionerId(
    values.practitionerId
  );
  const practitioner = practitionerId
    ? context.practitioners.find((p) => p.id === practitionerId)
    : undefined;

  const [hours, minutes] = values.startTime.split(':').map(Number);
  const day = parse(values.date, 'yyyy-MM-dd', new Date());
  const startDate = zonedWallTimeToUtc(
    day,
    hours || 0,
    minutes || 0,
    context.timeZone
  );

  const durationMinutes = resolveAppointmentDurationMinutes(
    service,
    context.defaultAppointmentDuration
  );
  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

  const color =
    (practitioner?.color as AppointmentColor | undefined) ??
    DEFAULT_APPOINTMENT_COLOR;

  const notes = values.notes?.trim();

  return {
    title: service?.name ?? 'Appointment',
    description: notes ? notes : undefined,
    startDate,
    endDate,
    color,
    leadId: values.leadId,
    serviceId: values.serviceId,
    ...(practitionerId ? { practitionerId } : {}),
  } as CreateAppointmentInput;
}

export interface AppointmentCreateDefaultsInput {
  /** The calendar day the slot sits on. */
  slotDate?: Date;
  /** Wall-clock time of the clicked slot, in the business timezone. */
  startTime?: { hour: number; minute: number };
  leadId?: string;
  serviceId?: string;
  practitionerId?: string;
  notes?: string;
}

/** Seed form values from a calendar slot / funnel search params. */
export function appointmentCreateDefaults({
  slotDate,
  startTime,
  leadId,
  serviceId,
  practitionerId,
  notes,
}: AppointmentCreateDefaultsInput): AppointmentCreateFormData {
  const day = slotDate ?? new Date();
  const hour = startTime?.hour ?? day.getHours();
  const minute = startTime?.minute ?? day.getMinutes();

  return {
    ...appointmentCreateForm.defaults,
    leadId: leadId ?? '',
    serviceId: serviceId ?? '',
    practitionerId: practitionerId ?? '',
    date: format(day, 'yyyy-MM-dd'),
    startTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    notes: notes ?? '',
  };
}
