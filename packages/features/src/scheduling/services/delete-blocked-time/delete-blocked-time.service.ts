import {
  blockedTime,
  blockedTimeException,
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
import { truncateRRule } from '../../utils/expand-blocked-time.js';
import {
  type DeleteBlockedTimeInput,
  deleteBlockedTimeSchema,
} from './delete-blocked-time.schema.js';

/**
 * Delete a blocked time with recurring-series scope semantics (contract §3.2):
 * - 'all' (default): delete the series (joins/exceptions cascade).
 * - 'this': upsert a cancelled exception for `originalStart`.
 * - 'following': truncate the series so it ends before `originalStart`.
 */
const deleteBlockedTimeImpl = async (
  db: DbConnection,
  input: DeleteBlockedTimeInput
): Promise<Result<{ id: string }>> => {
  const parsed = deleteBlockedTimeSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, scope, originalStart } = parsed.data;

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
          cancelled: true,
        })
        .onConflictDoUpdate({
          target: [
            blockedTimeException.blockedTimeId,
            blockedTimeException.originalStart,
          ],
          set: { cancelled: true, updatedAt: new Date() },
        });

      return ok({ id });
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

      return ok({ id });
    }

    // scope === 'all'
    await db
      .delete(blockedTime)
      .where(
        and(
          eq(blockedTime.id, id),
          eq(blockedTime.organizationId, organizationId)
        )
      )
      .returning({ id: blockedTime.id });

    return ok({ id });
  } catch (error) {
    logError('scheduling.deleteBlockedTime', error, {
      feature: 'scheduling',
      extra: { id, organizationId, scope },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to delete blocked time'
      )
    );
  }
};

export const deleteBlockedTime = (
  db: DbConnection,
  input: DeleteBlockedTimeInput
) =>
  trackedResult(
    'scheduling.deleteBlockedTime',
    () => withOrgScope((tx) => deleteBlockedTimeImpl(tx, input), { db }),
    {
      properties: {
        id: input.id,
        organizationId: input.organizationId,
        scope: input.scope,
      },
    }
  );

export type DeleteBlockedTimeResult = Awaited<
  ReturnType<typeof deleteBlockedTime>
>;
