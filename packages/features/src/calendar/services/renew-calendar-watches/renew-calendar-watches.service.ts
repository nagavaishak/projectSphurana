import { calendarAccount } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq, isNotNull, lte, or } from 'drizzle-orm';
import { type DbConnection, type Result, ok } from '../../../shared/index.js';
import { startCalendarWatch } from '../start-calendar-watch/start-calendar-watch.service.js';
import { stopCalendarWatch } from '../stop-calendar-watch/stop-calendar-watch.service.js';
import {
  type RenewCalendarWatchesInput,
  renewCalendarWatchesSchema,
} from './renew-calendar-watches.schema.js';

interface RenewResult {
  renewed: number;
  failed: number;
  total: number;
}

const renewCalendarWatchesImpl = async (
  db: DbConnection,
  input: RenewCalendarWatchesInput
): Promise<Result<RenewResult>> => {
  const parsed = renewCalendarWatchesSchema.safeParse(input);
  const expiringWithinHours = parsed.success
    ? parsed.data.expiringWithinHours
    : 24;

  const expirationThreshold = new Date(
    Date.now() + expiringWithinHours * 60 * 60 * 1000
  );

  // Find all active calendar accounts with watches expiring soon or already expired
  const expiringAccounts = await db
    .select({
      id: calendarAccount.id,
      organizationId: calendarAccount.organizationId,
      watchExpiration: calendarAccount.watchExpiration,
    })
    .from(calendarAccount)
    .where(
      and(
        eq(calendarAccount.isActive, true),
        eq(calendarAccount.syncEnabled, true),
        isNotNull(calendarAccount.watchChannelId),
        or(
          lte(calendarAccount.watchExpiration, expirationThreshold),
          lte(calendarAccount.watchExpiration, new Date())
        )
      )
    );

  let renewed = 0;
  let failed = 0;

  for (const account of expiringAccounts) {
    try {
      // Stop old watch
      await stopCalendarWatch(db, {
        calendarAccountId: account.id,
        organizationId: account.organizationId,
      });

      // Start new watch
      const result = await startCalendarWatch(db, {
        calendarAccountId: account.id,
        organizationId: account.organizationId,
      });

      if (result.success) {
        renewed++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return ok({ renewed, failed, total: expiringAccounts.length });
};

export const renewCalendarWatches = (
  db: DbConnection,
  input: RenewCalendarWatchesInput
) =>
  trackedResult(
    'calendar.renewCalendarWatches',
    () => renewCalendarWatchesImpl(db, input),
    {
      properties: { expiringWithinHours: input.expiringWithinHours },
      trackSuccess: false,
      trackFailure: false,
    }
  );

export type RenewCalendarWatchesResult = Awaited<
  ReturnType<typeof renewCalendarWatches>
>;
