import { differenceInMinutes, format, parse } from 'date-fns';
import { z } from 'zod';

import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { zonedEvent, zonedWallTimeToUtc } from '@/lib/timezone';

/**
 * SHARED CORE — appointment EDIT (the `PUT appointments/:id` form).
 *
 * Two surfaces edit a booking's fields: the desktop {@link EditEventDialog}
 * (also the target of a calendar drag/resize, which reaches the same
 * `config.onUpdateEvent`) and the {@link MobileBookingDetailSheet}. Both build
 * their next event through {@link applyAppointmentEdit}, which is the ONE place
 * the edited event is assembled — the provider then turns it into an intent
 * (`updateIntentFromCalendarEvent`) and the single builder into the wire body.
 *
 * Two things this convergence fixes:
 *  • the mobile sheet rendered NO control for `title` or the duration, so a
 *    booking could be renamed or re-timed on desktop and not on a phone, while
 *    both surfaces sent `title` in the body.
 *  • the duration select snapped to the nearest of six buckets, so saving an
 *    untouched 20-minute booking silently stretched it to 30. The current
 *    length is now always one of the options.
 */

/** The six standard lengths. The booking's own length is added when it isn't one. */
const BASE_DURATION_MINUTES = [15, 30, 45, 60, 90, 120];

export interface AppointmentDurationOption {
  value: string;
  label: string;
}

export function formatAppointmentDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours === 1) return '1 hour';
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours`;
}

/**
 * Duration options for a booking that currently runs `minutes` long. The
 * booking's own length is always present, so opening the form and saving it
 * cannot change the duration behind the user's back.
 */
export function appointmentDurationOptions(
  minutes: number
): AppointmentDurationOption[] {
  const values = BASE_DURATION_MINUTES.includes(minutes)
    ? BASE_DURATION_MINUTES
    : [...BASE_DURATION_MINUTES, minutes].sort((a, b) => a - b);
  return values.map((value) => ({
    value: String(value),
    label: formatAppointmentDuration(value),
  }));
}

export const appointmentEditForm = defineForm({
  fields: {
    /** The staff Select is keyed by PRACTITIONER id — never the user id. */
    assignedPractitionerId: {
      schema: z.string().optional(),
      label: 'Staff',
      control: 'select',
      default: '',
      sample: 'prac-9',
      sampleLabel: 'Rita',
      // Fans out to BOTH `assignedToId` (the owning user id) and
      // `practitionerId` — see applyAppointmentEdit.
      derived: true,
    },
    title: {
      schema: z.string().min(1, 'Title is required'),
      label: 'Title',
      control: 'text',
      default: '',
      sample: 'Balayage — root touch-up',
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
      sample: '11:00',
      derived: true,
    },
    /** Minutes, as a string → folded into endDate. */
    duration: {
      schema: z.string().min(1, 'Duration is required'),
      label: 'Duration',
      control: 'select',
      default: '60',
      sample: '90',
      sampleLabel: '1.5 hours',
      derived: true,
    },
    /** Free text → the appointment's `description`. */
    notes: {
      schema: z.string().optional(),
      label: 'Notes',
      control: 'textarea',
      default: '',
      sample: 'Moved at the client’s request.',
      derived: true,
    },
    /**
     * The front-desk status. NOT part of the edit panel — it is written by the
     * status stepper and the quick-actions menu, which patch this one key and
     * nothing else. It is declared here because it belongs to the same endpoint,
     * and the contract records WHICH surfaces own it rather than exempting it.
     */
    status: {
      schema: z.string().optional(),
      label: 'Status',
      control: 'custom',
      default: 'booked',
      sample: 'no_show',
    },
  },
});

export const appointmentEditSchema = appointmentEditForm.schema;
export const appointmentEditFields = appointmentEditForm.fields;

export type AppointmentEditFormData = InferFormValues<
  typeof appointmentEditForm
>;

/** Minimal shape the core needs off a calendar staff member. */
export interface AppointmentEditStaff {
  id: string;
  name: string;
  picturePath?: string | null;
  userId?: string | null;
  color?: string | null;
}

/** Minimal shape the core needs off a calendar event. */
export interface AppointmentEditEvent {
  id: string | number;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  user: { id: string; name: string; picturePath?: string | null };
  metadata?: Record<string, unknown>;
}

export interface AppointmentEditContext {
  /** The calendar's staff list, keyed by PRACTITIONER id. */
  users: AppointmentEditStaff[];
  /** organization.timezone — the zone the picked wall-clock is in. */
  timeZone: string;
}

/** The practitioner currently assigned, resolved the one way for every surface. */
export function currentAppointmentPractitionerId(
  event: AppointmentEditEvent,
  users: AppointmentEditStaff[]
): string {
  if (typeof event.metadata?.practitionerId === 'string') {
    return event.metadata.practitionerId;
  }
  return users.find((u) => !!u.userId && u.userId === event.user.id)?.id ?? '';
}

/**
 * The staff options for this event — the active list, plus a synthetic entry for
 * the current assignee when they are no longer active, so an edit never silently
 * reassigns the booking.
 */
export function appointmentEditStaffOptions(
  event: AppointmentEditEvent,
  users: AppointmentEditStaff[]
): AppointmentEditStaff[] {
  const currentId = currentAppointmentPractitionerId(event, users);
  if (!currentId || users.some((u) => u.id === currentId)) return users;
  return [
    {
      id: currentId,
      name:
        (typeof event.metadata?.staffMemberName === 'string'
          ? event.metadata.staffMemberName
          : undefined) ?? event.user.name,
      picturePath: event.user.picturePath ?? null,
    },
    ...users,
  ];
}

/** The booking's current length, in minutes. */
export function appointmentEventDuration(
  event: AppointmentEditEvent,
  timeZone: string
): number {
  return Math.max(
    differenceInMinutes(
      zonedEvent(event.endDate, timeZone),
      zonedEvent(event.startDate, timeZone)
    ),
    0
  );
}

/** Seed the form from the saved event — one seeding for every surface. */
export function appointmentEditDefaults(
  event: AppointmentEditEvent,
  context: AppointmentEditContext
): AppointmentEditFormData {
  const start = zonedEvent(event.startDate, context.timeZone);
  return {
    ...appointmentEditForm.defaults,
    assignedPractitionerId: currentAppointmentPractitionerId(
      event,
      context.users
    ),
    title: event.title,
    date: format(start, 'yyyy-MM-dd'),
    startTime: format(start, 'HH:mm'),
    duration: String(appointmentEventDuration(event, context.timeZone)),
    notes: event.description || '',
    status:
      typeof event.metadata?.status === 'string'
        ? event.metadata.status
        : appointmentEditForm.defaults.status,
  };
}

/**
 * THE ONLY place an edited appointment event is assembled.
 *
 * A picked practitioner maps to BOTH the owning user id (`user.id` →
 * `assignedToId`) and the practitioner id (`metadata.practitionerId` →
 * `practitionerId`), so a practitioner id can never land in the user FK — the
 * historical id-crossing bug. Start is the picked wall-clock resolved in the
 * BUSINESS timezone; end is start + the picked duration.
 */
export function applyAppointmentEdit<E extends AppointmentEditEvent>(
  event: E,
  values: AppointmentEditFormData,
  context: AppointmentEditContext
): E {
  const selected = context.users.find(
    (u) => u.id === values.assignedPractitionerId
  );

  const nextUser = selected
    ? {
        id: selected.userId ?? '',
        name: selected.name,
        picturePath: selected.picturePath ?? null,
        userId: selected.userId ?? null,
        color: selected.color ?? null,
      }
    : event.user;
  const nextMetadata = selected
    ? { ...event.metadata, practitionerId: selected.id }
    : event.metadata;

  const [hours, minutes] = values.startTime.split(':').map(Number);
  const day = parse(values.date, 'yyyy-MM-dd', new Date());
  const startDate = zonedWallTimeToUtc(
    day,
    hours || 0,
    minutes || 0,
    context.timeZone
  );
  const durationMinutes = Number.parseInt(values.duration, 10);
  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

  return {
    ...event,
    user: nextUser,
    metadata: nextMetadata,
    title: values.title,
    description: values.notes || '',
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  } as E;
}
