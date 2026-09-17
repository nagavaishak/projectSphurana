import {
  type BlockedTimeException,
  type BlockedTimePractitioner,
  blockedTime,
  blockedTimeException,
  blockedTimePractitioner,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, gte, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { BlockedTimeWithPractitioners } from '../../models/scheduling.types.js';
import { expandBlockedTime } from '../../utils/expand-blocked-time.js';
import {
  type ListBlockedTimeInput,
  listBlockedTimeSchema,
} from './list-blocked-time.schema.js';

/**
 * List blocked time as expanded occurrences within a window (contract §3.2),
 * mirroring the unavailability expansion. Org-wide blocks (zero join rows)
 * always match; when `practitionerId` is given, targeted blocks match only if
 * they include that practitioner.
 */
const listBlockedTimeImpl = async (
  db: DbConnection,
  input: ListBlockedTimeInput
): Promise<Result<BlockedTimeWithPractitioners[]>> => {
  const parsed = listBlockedTimeSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, practitionerId, locationId, from, to } = parsed.data;

  try {
    const series = await db
      .select()
      .from(blockedTime)
      .where(
        and(
          eq(blockedTime.organizationId, organizationId),
          // A NULL `location_id` means "all branches" (plan §2.2) — it must
          // stay VISIBLE under a branch filter, not be hidden as unscoped. The
          // clinic-wide Christmas closure is exactly such a row.
          ...(locationId
            ? [
                or(
                  isNull(blockedTime.locationId),
                  eq(blockedTime.locationId, locationId)
                ),
              ]
            : []),
          or(
            // Single occurrence overlapping window
            and(
              isNull(blockedTime.rrule),
              lte(blockedTime.startDate, to),
              gte(blockedTime.endDate, from)
            ),
            // Recurring: starts before window ends and series not yet expired
            and(
              isNotNull(blockedTime.rrule),
              lte(blockedTime.startDate, to),
              or(
                isNull(blockedTime.recurrenceEndDate),
                gte(blockedTime.recurrenceEndDate, from)
              )
            )
          )
        )
      );

    if (series.length === 0) {
      return ok([]);
    }

    const seriesIds = series.map((s) => s.id);

    const joins: BlockedTimePractitioner[] = await db
      .select()
      .from(blockedTimePractitioner)
      .where(inArray(blockedTimePractitioner.blockedTimeId, seriesIds));

    const practitionersBySeries = new Map<string, string[]>();
    for (const join of joins) {
      const list = practitionersBySeries.get(join.blockedTimeId) ?? [];
      list.push(join.practitionerId);
      practitionersBySeries.set(join.blockedTimeId, list);
    }

    const exceptions: BlockedTimeException[] = await db
      .select()
      .from(blockedTimeException)
      .where(
        and(
          inArray(blockedTimeException.blockedTimeId, seriesIds),
          gte(blockedTimeException.originalStart, from),
          lte(blockedTimeException.originalStart, to)
        )
      );

    const exceptionsBySeries = new Map<string, BlockedTimeException[]>();
    for (const exc of exceptions) {
      const list = exceptionsBySeries.get(exc.blockedTimeId) ?? [];
      list.push(exc);
      exceptionsBySeries.set(exc.blockedTimeId, list);
    }

    const occurrences: BlockedTimeWithPractitioners[] = [];
    for (const s of series) {
      const practitionerIds = practitionersBySeries.get(s.id) ?? [];

      // Zero join rows = org-wide block: applies to every practitioner.
      if (
        practitionerId &&
        practitionerIds.length > 0 &&
        !practitionerIds.includes(practitionerId)
      ) {
        continue;
      }

      occurrences.push(
        ...expandBlockedTime(
          s,
          practitionerIds,
          exceptionsBySeries.get(s.id) ?? [],
          from,
          to
        )
      );
    }

    occurrences.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    return ok(occurrences);
  } catch (error) {
    logError('scheduling.listBlockedTime', error, {
      feature: 'scheduling',
      extra: { organizationId, practitionerId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to list blocked time')
    );
  }
};

export const listBlockedTime = (
  db: DbConnection,
  input: ListBlockedTimeInput
) =>
  trackedResult(
    'scheduling.listBlockedTime',
    () => withOrgScope((tx) => listBlockedTimeImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        practitionerId: input.practitionerId,
      },
    }
  );

export type ListBlockedTimeResult = Awaited<ReturnType<typeof listBlockedTime>>;
