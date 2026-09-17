import {
  blockedTime,
  blockedTimeException,
  blockedTimePractitioner,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { BlockedTimeWithPractitioners } from '../../models/scheduling.types.js';
import { truncateRRule } from '../../utils/expand-blocked-time.js';
import {
  type UpdateBlockedTimeInput,
  updateBlockedTimeSchema,
} from './update-blocked-time.schema.js';

const loadPractitionerIds = async (
  db: DbConnection,
  blockedTimeId: string
): Promise<string[]> => {
  const joins = await db
    .select()
    .from(blockedTimePractitioner)
    .where(eq(blockedTimePractitioner.blockedTimeId, blockedTimeId));
  return joins.map((j: { practitionerId: string }) => j.practitionerId);
};

const replacePractitioners = async (
  db: DbConnection,
  blockedTimeId: string,
  practitionerIds: string[]
): Promise<void> => {
  await db
    .delete(blockedTimePractitioner)
    .where(eq(blockedTimePractitioner.blockedTimeId, blockedTimeId));
  if (practitionerIds.length > 0) {
    await db.insert(blockedTimePractitioner).values(
      practitionerIds.map((practitionerId) => ({
        blockedTimeId,
        practitionerId,
      }))
    );
  }
};

/**
 * Update a blocked time with recurring-series scope semantics mirroring
 * unavailability (contract §3.2):
 * - 'all' (default): update the series; optionally replace practitioner set.
 * - 'this': upsert a blocked_time_exception for `originalStart`.
 * - 'following': truncate the series before `originalStart`, then create a
 *   new series (with copied practitioner set) starting at the occurrence.
 */
const updateBlockedTimeImpl = async (
  db: DbConnection,
  input: UpdateBlockedTimeInput
): Promise<Result<BlockedTimeWithPractitioners>> => {
  const parsed = updateBlockedTimeSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    id,
    organizationId,
    scope,
    originalStart,
    practitionerIds,
    createdById,
    ...updates
  } = parsed.data;

  try {
    const [series] = await db
      .select()
      .from(blockedTime)
      .where(
        and(
          eq(blockedTime.id, id),
          eq(blockedTime.organizationId, organizationId)
        )
      );

    if (!series) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Blocked time not found')
      );
    }

    const effectiveScope = series.rrule ? scope : 'all';

    if (effectiveScope === 'this') {
      if (!originalStart) {
        return err(
          new FeatureError(
            ErrorCodes.VALIDATION_ERROR,
            "originalStart is required for scope='this'"
          )
        );
      }

      await db
        .insert(blockedTimeException)
        .values({
          blockedTimeId: id,
          originalStart,
          cancelled: false,
          startDate: updates.startDate ?? null,
          endDate: updates.endDate ?? null,
          title: updates.title ?? null,
          description: updates.description ?? null,
        })
        .onConflictDoUpdate({
          target: [
            blockedTimeException.blockedTimeId,
            blockedTimeException.originalStart,
          ],
          set: {
            cancelled: false,
            startDate: updates.startDate ?? null,
            endDate: updates.endDate ?? null,
            title: updates.title ?? null,
            description: updates.description ?? null,
            updatedAt: new Date(),
          },
        });

      const currentPractitioners = await loadPractitionerIds(db, id);
      return ok({ ...series, practitionerIds: currentPractitioners });
    }

    if (effectiveScope === 'following') {
      if (!originalStart) {
        return err(
          new FeatureError(
            ErrorCodes.VALIDATION_ERROR,
            "originalStart is required for scope='following'"
          )
        );
      }
      if (!createdById) {
        return err(
          new FeatureError(
            ErrorCodes.VALIDATION_ERROR,
            "createdById is required for scope='following'"
          )
        );
      }

      // Truncate the existing series so it ends just before this occurrence.
      const truncateUntil = new Date(originalStart.getTime() - 1);
      await db
        .update(blockedTime)
        .set({
          rrule: truncateRRule(series.rrule ?? '', truncateUntil),
          recurrenceEndDate: truncateUntil,
          updatedAt: new Date(),
        })
        .where(eq(blockedTime.id, id))
        .returning();

      // Create the new series starting at this occurrence.
      const newStart = updates.startDate ?? originalStart;
      const newEnd =
        updates.endDate ??
        new Date(
          newStart.getTime() +
            (series.endDate.getTime() - series.startDate.getTime())
        );

      const [newSeries] = await db
        .insert(blockedTime)
        .values({
          organizationId,
          blockedTimeTypeId:
            updates.blockedTimeTypeId === undefined
              ? series.blockedTimeTypeId
              : updates.blockedTimeTypeId,
          title: updates.title ?? series.title,
          description: updates.description ?? series.description,
          startDate: newStart,
          endDate: newEnd,
          allDay: updates.allDay ?? series.allDay,
          timezone: updates.timezone ?? series.timezone,
          rrule: updates.rrule === undefined ? series.rrule : updates.rrule,
          recurrenceEndDate:
            updates.recurrenceEndDate === undefined
              ? series.recurrenceEndDate
              : updates.recurrenceEndDate,
          paid: updates.paid ?? series.paid,
          createdById,
        })
        .returning();

      const newPractitionerIds =
        practitionerIds ?? (await loadPractitionerIds(db, id));
      if (newPractitionerIds.length > 0) {
        await db.insert(blockedTimePractitioner).values(
          newPractitionerIds.map((practitionerId) => ({
            blockedTimeId: newSeries.id,
            practitionerId,
          }))
        );
      }

      return ok({ ...newSeries, practitionerIds: newPractitionerIds });
    }

    // scope === 'all'
    const patch = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );

    const [updated] = await db
      .update(blockedTime)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(blockedTime.id, id),
          eq(blockedTime.organizationId, organizationId)
        )
      )
      .returning();

    if (practitionerIds !== undefined) {
      await replacePractitioners(db, id, practitionerIds);
      return ok({ ...updated, practitionerIds });
    }

    const currentPractitioners = await loadPractitionerIds(db, id);
    return ok({ ...updated, practitionerIds: currentPractitioners });
  } catch (error) {
    logError('scheduling.updateBlockedTime', error, {
      feature: 'scheduling',
      extra: { id, organizationId, scope },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update blocked time'
      )
    );
  }
};

export const updateBlockedTime = (
  db: DbConnection,
  input: UpdateBlockedTimeInput
) =>
  trackedResult(
    'scheduling.updateBlockedTime',
    () => withOrgScope((tx) => updateBlockedTimeImpl(tx, input), { db }),
    {
      properties: {
        id: input.id,
        organizationId: input.organizationId,
        scope: input.scope,
      },
    }
  );

export type UpdateBlockedTimeResult = Awaited<
  ReturnType<typeof updateBlockedTime>
>;
