import { z } from 'zod';
import { type JobInput, type JobOutput, defineJob } from '../define-job.js';
import { appointmentLifecycleQueue } from '../queues.js';

/**
 * The `appointment-lifecycle` queue carries three job names. The worker routes
 * on `job.name` — and used to do so with a `default:` branch that logged a
 * warning and marked the job COMPLETED. Add a fourth job name and it would
 * complete having done nothing, silently.
 *
 * Declaring the three jobs here gives the worker a discriminated union to
 * switch on, so a missing handler is a compile error (`assertNever`).
 */
export const APPOINTMENT_JOBS = {
  sendReminder: 'send-reminder',
  expireDeposit: 'expire-deposit',
  calendarSync: 'calendar-sync',
} as const;

export const sendReminderJob = defineJob({
  queue: appointmentLifecycleQueue,
  name: APPOINTMENT_JOBS.sendReminder,
  payload: z.object({
    appointmentId: z.string().min(1),
    kind: z.enum(['24h', '1h']),
  }),
});

export const expireDepositJob = defineJob({
  queue: appointmentLifecycleQueue,
  name: APPOINTMENT_JOBS.expireDeposit,
  payload: z.object({ depositId: z.string().min(1) }),
});

export const calendarSyncJob = defineJob({
  queue: appointmentLifecycleQueue,
  name: APPOINTMENT_JOBS.calendarSync,
  payload: z.object({
    appointmentId: z.string().min(1),
    organizationId: z.string().min(1),
    action: z.enum(['create', 'update', 'delete']),
  }),
});

/** Every job on the queue. */
export const appointmentJobs = [
  sendReminderJob,
  expireDepositJob,
  calendarSyncJob,
] as const;

export type SendReminderJobData = JobOutput<typeof sendReminderJob>;
export type ExpireDepositJobData = JobOutput<typeof expireDepositJob>;
export type CalendarSyncJobData = JobOutput<typeof calendarSyncJob>;

export type SendReminderJobInput = JobInput<typeof sendReminderJob>;
export type ExpireDepositJobInput = JobInput<typeof expireDepositJob>;
export type CalendarSyncJobInput = JobInput<typeof calendarSyncJob>;

/**
 * The discriminated union the worker switches on. `name` is the discriminant;
 * `data` is the payload declared for that name. `assertNever` in the default
 * branch turns "new job name, no handler" into a compile error instead of a
 * job that completes having done nothing.
 */
export type AppointmentLifecycleJob =
  | { name: typeof APPOINTMENT_JOBS.sendReminder; data: SendReminderJobData }
  | { name: typeof APPOINTMENT_JOBS.expireDeposit; data: ExpireDepositJobData }
  | { name: typeof APPOINTMENT_JOBS.calendarSync; data: CalendarSyncJobData };

export type AppointmentJobData = AppointmentLifecycleJob['data'];
