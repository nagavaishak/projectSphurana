import { session } from '@borradh-workspace/database';
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
import type { RedisLike } from '../invalidate-user-sessions/invalidate-user-sessions.service.js';
import {
  type ClearActiveOrgSessionsInput,
  clearActiveOrgSessionsSchema,
} from './clear-active-org-sessions.schema.js';

export interface ClearActiveOrgSessionsResponse {
  updatedCount: number;
}

const clearActiveOrgSessionsImpl = async (
  db: DbConnection,
  input: ClearActiveOrgSessionsInput,
  redis?: RedisLike | null
): Promise<Result<ClearActiveOrgSessionsResponse>> => {
  const parsed = clearActiveOrgSessionsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { userId, organizationId } = parsed.data;

  try {
    // 1. Find sessions with this activeOrganizationId for this user
    const affectedSessions = await db
      .select({ token: session.token })
      .from(session)
      .where(
        and(
          eq(session.userId, userId),
          eq(session.activeOrganizationId, organizationId)
        )
      );

    // 2. Clear activeOrganizationId from those sessions in the database
    await db
      .update(session)
      .set({ activeOrganizationId: null })
      .where(
        and(
          eq(session.userId, userId),
          eq(session.activeOrganizationId, organizationId)
        )
      );

    // 3. Clear Redis cached sessions so the stale org ID is not served
    if (redis && affectedSessions.length > 0) {
      const redisKeys = affectedSessions.map((s) => s.token);
      try {
        await redis.del(...redisKeys);
      } catch (redisError) {
        logError('auth.clearActiveOrgSessions.redis', redisError, {
          feature: 'auth',
          extra: { userId, organizationId, count: affectedSessions.length },
        });
      }
    }

    return ok({ updatedCount: affectedSessions.length });
  } catch (error) {
    logError('auth.clearActiveOrgSessions', error, {
      feature: 'auth',
      extra: { userId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to clear organization sessions'
      )
    );
  }
};

export const clearActiveOrgSessions = (
  db: DbConnection,
  input: ClearActiveOrgSessionsInput,
  redis?: RedisLike | null
) =>
  trackedResult(
    'auth.clearActiveOrgSessions',
    () => clearActiveOrgSessionsImpl(db, input, redis),
    {
      properties: {
        userId: input.userId,
        organizationId: input.organizationId,
      },
    }
  );

export type ClearActiveOrgSessionsResult = Awaited<
  ReturnType<typeof clearActiveOrgSessions>
>;
