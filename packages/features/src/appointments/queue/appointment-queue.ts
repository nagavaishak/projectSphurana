import { appointment, appointmentDeposit } from '@borradh-workspace/database';
/**
 * `appointment-lifecycle` BullMQ queue — moves booking side-effects off the
 * request path and off the single-replica cron so they run durably with
 * retries, a dead-letter queue, and a bounded worker concurrency instead of:
 *   - unbounded fire-and-forget promises that vanish on process restart, and
 *   - a fixed per-tick reminder/deposit batch that silently dropped work once
 *     more items fell in a window than one tick could drain.
 *
 * One queue, routed by BullMQ job name (see APPOINTMENT_JOBS). The consumer
 * lives in `apps/api/src/booking-worker`.
 */
import { logError } from '@borradh-workspace/observability';
import type { Queue } from 'bullmq';
import { and, between, eq, isNull, lt } from 'drizzle-orm';
import {
  type CalendarSyncJobInput,
  appointmentLifecycleQueue,
  calendarSyncJob,
  closeJobQueue,
  enqueueJob,
  expireDepositJob,
  getJobQueue,
  sendReminderJob,
} from '../../jobs/index.js';
import { type DbConnection, notDeleted } from '../../shared/index.js';
import { safeJobId } from '../../shared/queue/index.js';

// Queue name, job names, payloads and retry policy are all DECLARED ONCE in
// `jobs/` — the worker reads the same declarations, so a job name or a payload
// field cannot drift between the two sides.
export const APPOINTMENT_LIFECYCLE_QUEUE = appointmentLifecycleQueue.name;

export {
  APPOINTMENT_JOBS,
  type CalendarSyncJobData,
  type ExpireDepositJobData,
  type SendReminderJobData,
} from '../../jobs/index.js';

export function getAppointmentQueue(): Queue {
  return getJobQueue(appointmentLifecycleQueue);
}

export async function closeAppointmentQueue(): Promise<void> {
  await closeJobQueue(appointmentLifecycleQueue);
}

/**
 * Enqueue a calendar sync. Replaces the fire-and-forget `syncToCalendar(...)`
 * calls on appointment create/update/delete so a slow/failed Google call is
 * retried on the worker rather than lost on the request path. Best-effort: a
 * Redis outage must not fail the booking, so enqueue failures are logged, not
 * thrown.
 */
export async function enqueueCalendarSync(
  data: CalendarSyncJobInput
): Promise<void> {
  try {
    await enqueueJob(calendarSyncJob, data, {
      // Dedup concurrent syncs for the same appointment+action; safe because the
      // create path also uses a deterministic Google event id (409-idempotent).
      jobId: safeJobId('calsync', data.appointmentId, data.action),
    });
  } catch (error) {
    logError('appointments.enqueueCalendarSync', error, {
      feature: 'appointments',
      extra: { appointmentId: data.appointmentId, action: data.action },
    });
  }
}

/**
 * Scan appointments whose 24h / 1h reminder is due and enqueue one job each.
 * Called by the reminder cron. Deterministic per-appointment+kind job ids make
 * re-scanning every tick idempotent (a still-queued reminder is not duplicated),
 * and the per-item handler is itself idempotent. Returns how many were enqueued.
 */
export async function enqueueDueReminders(
  db: DbConnection,
  opts: { maxPerRun?: number } = {}
): Promise<{ enqueued24h: number; enqueued1h: number; capped: boolean }> {
  const maxPerRun = opts.maxPerRun ?? 2000;
  const now = Date.now();

  const scanWindow = async (
    kind: '24h' | '1h',
    fromMs: number,
    toMs: number,
    sentColumn:
      | typeof appointment.reminderSentAt24h
      | typeof appointment.reminderSentAt1h
  ): Promise<number> => {
    const due = await db
      .select({ id: appointment.id })
      .from(appointment)
      .where(
        and(
          isNull(sentColumn),
          notDeleted(appointment),
          between(appointment.startDate, new Date(fromMs), new Date(toMs))
        )
      )
      .limit(maxPerRun);
    // Status filter is applied by the worker's claim UPDATE; keeping the scan
    // lean lets the partial reminder indexes serve it.
    for (const row of due) {
      await enqueueJob(
        sendReminderJob,
        { appointmentId: row.id, kind },
        { jobId: safeJobId('reminder', row.id, kind) }
      );
    }
    return due.length;
  };

  const enqueued24h = await scanWindow(
    '24h',
    now + 23 * 60 * 60 * 1000,
    now + 25 * 60 * 60 * 1000,
    appointment.reminderSentAt24h
  );
  const enqueued1h = await scanWindow(
    '1h',
    now + 30 * 60 * 1000,
    now + 90 * 60 * 1000,
    appointment.reminderSentAt1h
  );

  const capped = enqueued24h >= maxPerRun || enqueued1h >= maxPerRun;
  if (capped) {
    logError(
      'appointments.enqueueDueReminders.capped',
      new Error('Reminder scan hit maxPerRun cap'),
      {
        feature: 'appointments',
        extra: { maxPerRun, enqueued24h, enqueued1h },
      }
    );
  }
  return { enqueued24h, enqueued1h, capped };
}

/**
 * Scan pending deposits that have passed their expiry and enqueue one expiry job
 * each. Called by the deposit cron. Deterministic per-deposit job ids + an
 * idempotent handler make re-scanning safe.
 */
export async function enqueueDueDepositExpirations(
  db: DbConnection,
  opts: { maxPerRun?: number } = {}
): Promise<{ enqueued: number; capped: boolean }> {
  const maxPerRun = opts.maxPerRun ?? 2000;

  const due = await db
    .select({ id: appointmentDeposit.id })
    .from(appointmentDeposit)
    .where(
      and(
        eq(appointmentDeposit.status, 'pending'),
        lt(appointmentDeposit.expiresAt, new Date())
      )
    )
    .limit(maxPerRun);

  for (const row of due) {
    await enqueueJob(
      expireDepositJob,
      { depositId: row.id },
      { jobId: safeJobId('expire', row.id) }
    );
  }

  const capped = due.length >= maxPerRun;
  if (capped) {
    logError(
      'appointments.enqueueDueDepositExpirations.capped',
      new Error('Deposit expiry scan hit maxPerRun cap'),
      { feature: 'appointments', extra: { maxPerRun, enqueued: due.length } }
    );
  }
  return { enqueued: due.length, capped };
}
