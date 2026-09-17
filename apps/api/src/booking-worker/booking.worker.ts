import { db, withSystemScope } from '@borradh-workspace/database';
import {
  expireAppointmentDeposit,
  sendAppointmentReminder,
} from '@borradh-workspace/features/appointments';
import { syncToCalendar } from '@borradh-workspace/features/calendar';
import {
  APPOINTMENT_JOBS,
  type AppointmentJobData,
  type AppointmentLifecycleJob,
  appointmentLifecycleQueue,
  assertNever,
  calendarSyncJob,
  expireDepositJob,
  parseJobData,
  sendReminderJob,
} from '@borradh-workspace/features/jobs';
import {
  isTerminalFailure,
  moveToDeadLetter,
} from '@borradh-workspace/features/shared/queue';
import { createLogger, logError } from '@borradh-workspace/observability';
import {
  getBullMqPrefix,
  getRedis,
  isTransientRedisError,
} from '@borradh-workspace/redis';
import { type Job, Worker } from 'bullmq';

const logger = createLogger('BookingWorker');

/**
 * BullMQ worker for the `appointment-lifecycle` queue. Runs booking
 * side-effects (reminders, deposit expiry, calendar sync) off the request path
 * and off the single-replica cron, with bounded concurrency (so we never fan out
 * an unbounded number of concurrent Google/email calls) and retries.
 *
 * Every handler is idempotent, so retries and duplicate deliveries are safe. A
 * handler that returns an error Result throws so BullMQ retries; terminal
 * failures are dead-lettered.
 *
 * The routing switch is EXHAUSTIVE over the job names declared on the queue.
 * It used to end in a `default:` that logged a warning and let the job complete
 * — so adding a fourth job name would have produced jobs that reported SUCCESS
 * having done nothing. `assertNever` makes that a compile error instead.
 */
export function createBookingWorker(): Worker<AppointmentJobData> {
  const worker = new Worker<AppointmentJobData>(
    appointmentLifecycleQueue.name,
    async (job: Job<AppointmentJobData>) => {
      // Narrow `job.name` + `job.data` together, and PARSE the payload against
      // the one declaration the producer had to satisfy.
      const routed = {
        name: job.name,
        data: job.data,
      } as AppointmentLifecycleJob;

      switch (routed.name) {
        case APPOINTMENT_JOBS.sendReminder: {
          const data = parseJobData(sendReminderJob, job.data);
          const result = await withSystemScope(
            (conn) => sendAppointmentReminder(conn, data),
            { db }
          );
          if (!result.success) throw new Error(result.error.message);
          return;
        }
        case APPOINTMENT_JOBS.expireDeposit: {
          const data = parseJobData(expireDepositJob, job.data);
          const result = await withSystemScope(
            (conn) => expireAppointmentDeposit(conn, data),
            { db }
          );
          if (!result.success) throw new Error(result.error.message);
          return;
        }
        case APPOINTMENT_JOBS.calendarSync: {
          const data = parseJobData(calendarSyncJob, job.data);
          // syncToCalendar wraps itself in withOrgScope internally.
          const result = await syncToCalendar(db, data);
          if (!result.success) throw new Error(result.error.message);
          return;
        }
        default:
          // Not reachable: every declared job name has a handler above, and a
          // NEW one fails to compile here rather than silently completing.
          return assertNever(routed, 'booking.worker');
      }
    },
    {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      // Bounded fan-out: caps concurrent Google/email calls under a booking or
      // reminder burst instead of the old unbounded fire-and-forget.
      concurrency: 10,
    }
  );

  worker.on('failed', async (job, error) => {
    logError('appointments.bookingWorker.jobFailed', error, {
      feature: 'appointments',
      extra: {
        jobId: job?.id,
        name: job?.name,
        attemptsMade: job?.attemptsMade,
      },
    });

    if (job && isTerminalFailure(job)) {
      await moveToDeadLetter({
        queueName: appointmentLifecycleQueue.name,
        job,
        error,
        context: { name: job.name },
      });
    }
  });

  worker.on('error', (error) => {
    if (isTransientRedisError(error)) {
      logger.warn('Transient Redis error (auto-recovering)', {
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    logError('appointments.bookingWorker.error', error, {
      feature: 'appointments',
    });
  });

  return worker;
}
