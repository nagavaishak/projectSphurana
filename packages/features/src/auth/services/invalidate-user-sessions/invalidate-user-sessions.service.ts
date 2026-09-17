import { session } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type InvalidateUserSessionsInput,
  invalidateUserSessionsSchema,
} from './invalidate-user-sessions.schema.js';

/**
 * Optional Redis client type for clearing secondary session storage.
 * When provided, session tokens are also deleted from Redis.
 */
export interface RedisLike {
  del: (...keys: string[]) => Promise<number>;
}

export interface InvalidateUserSessionsResponse {
  deletedCount: number;
}

const invalidateUserSessionsImpl = async (
  db: DbConnection,
  input: InvalidateUserSessionsInput,
  redis?: RedisLike | null
): Promise<Result<InvalidateUserSessionsResponse>> => {
  const parsed = invalidateUserSessionsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { userId } = parsed.data;

  try {
    // 1. Find all sessions for this user (need tokens for Redis cleanup)
    const userSessions = await db
      .select({ token: session.token })
      .from(session)
      .where(eq(session.userId, userId));

    // 2. Delete sessions from database
    await db.delete(session).where(eq(session.userId, userId));

    // 3. Clean up Redis secondary storage if available
    if (redis && userSessions.length > 0) {
      const redisKeys = [
        ...userSessions.map((s) => s.token),
        `active-sessions-${userId}`,
      ];
      try {
        await redis.del(...redisKeys);
      } catch (redisError) {
        // Redis cleanup is best-effort; DB sessions are already deleted
        logError('auth.invalidateUserSessions.redis', redisError, {
          feature: 'auth',
          extra: { userId, sessionCount: userSessions.length },
        });
      }
    }

    return ok({ deletedCount: userSessions.length });
  } catch (error) {
    logError('auth.invalidateUserSessions', error, {
      feature: 'auth',
      extra: { userId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to invalidate user sessions'
      )
    );
  }
};

export const invalidateUserSessions = (
  db: DbConnection,
  input: InvalidateUserSessionsInput,
  redis?: RedisLike | null
) =>
  trackedResult(
    'auth.invalidateUserSessions',
    () => invalidateUserSessionsImpl(db, input, redis),
    { properties: { userId: input.userId } }
  );

export type InvalidateUserSessionsResult = Awaited<
  ReturnType<typeof invalidateUserSessions>
>;
