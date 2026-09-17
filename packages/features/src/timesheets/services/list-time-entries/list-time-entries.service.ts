import {
  practitionerLocation,
  timeEntry,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { type SQL, and, desc, eq, gte, lte } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  atLocationOrUnassigned,
  err,
  ok,
} from '../../../shared/index.js';
import type { TimeEntryWithBreaks } from '../../models/index.js';
import {
  type ListTimeEntriesInput,
  listTimeEntriesSchema,
} from './list-time-entries.schema.js';

/**
 * List time entries (with breaks) for an organization, filtered by clock-in
 * window, practitioner, and status.
 */
const listTimeEntriesImpl = async (
  db: DbConnection,
  input: ListTimeEntriesInput
): Promise<Result<TimeEntryWithBreaks[]>> => {
  const parsed = listTimeEntriesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, from, to, practitionerId, locationId, status } =
    parsed.data;

  try {
    const conditions: SQL[] = [eq(timeEntry.organizationId, organizationId)];
    if (from) conditions.push(gte(timeEntry.clockIn, from));
    if (to) conditions.push(lte(timeEntry.clockIn, to));
    if (practitionerId) {
      conditions.push(eq(timeEntry.practitionerId, practitionerId));
    }
    if (status) conditions.push(eq(timeEntry.status, status));
    if (locationId) {
      conditions.push(
        atLocationOrUnassigned(
          db,
          practitionerLocation,
          practitionerLocation.practitionerId,
          timeEntry.practitionerId,
          practitionerLocation.locationId,
          locationId
        )
      );
    }

    const items = await db.query.timeEntry.findMany({
      where: and(...conditions),
      with: { breaks: true },
      orderBy: [desc(timeEntry.clockIn)],
    });

    return ok(items as TimeEntryWithBreaks[]);
  } catch (error) {
    logError('timesheets.listTimeEntries', error, {
      feature: 'timesheets',
      extra: { organizationId, practitionerId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to list time entries')
    );
  }
};

export const listTimeEntries = (
  db: DbConnection,
  input: ListTimeEntriesInput
) =>
  trackedResult(
    'timesheets.listTimeEntries',
    () => withOrgScope((tx) => listTimeEntriesImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type ListTimeEntriesServiceResult = Awaited<
  ReturnType<typeof listTimeEntries>
>;
