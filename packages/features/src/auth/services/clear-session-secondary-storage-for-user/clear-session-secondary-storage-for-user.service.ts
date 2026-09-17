import type { User } from '@borradh-workspace/database';
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
import { getUser } from '../../../users/index.js';
import {
  type ClearSessionSecondaryStorageForUserInput,
  clearSessionSecondaryStorageForUserSchema,
} from './clear-session-secondary-storage-for-user.schema.js';

/**
 * Redis client shape for Better Auth secondaryStorage (see better-auth internal-adapter).
 * Session payloads live under key === session token (not `session:<token>`).
 * Matches ioredis / secondaryStorage usage (`set` has many overloads).
 */
export type SessionSecondaryStorageRedis = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ...args: unknown[]) => Promise<unknown>;
  ttl: (key: string) => Promise<number>;
  del: (...keys: string[]) => Promise<number>;
};

function safeJsonParse(value: string): {
  session?: Record<string, unknown>;
  user?: Record<string, unknown>;
} | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    if (!o.session || !o.user || typeof o.user !== 'object') return null;
    return {
      session: o.session as Record<string, unknown>,
      user: o.user as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

function sessionUserFromDbRow(u: User): Record<string, unknown> {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    emailVerified: u.emailVerified,
    image: u.image,
    currency: u.currency,
    timezone: u.timezone,
    role: u.role,
    banned: u.banned,
    banReason: u.banReason,
    banExpires: u.banExpires,
    twoFactorEnabled: u.twoFactorEnabled,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

export interface ClearSessionSecondaryStorageForUserResponse {
  /** Session tokens successfully refreshed in Redis */
  refreshedCount: number;
}

const collectSessionTokens = async (
  db: DbConnection,
  userId: string,
  redis: SessionSecondaryStorageRedis | null
): Promise<string[]> => {
  const tokens = new Set<string>();

  const dbSessions = await db
    .select({ token: session.token })
    .from(session)
    .where(eq(session.userId, userId));
  for (const row of dbSessions) {
    tokens.add(row.token);
  }

  if (redis) {
    const activeKey = `active-sessions-${userId}`;
    const listRaw = await redis.get(activeKey);
    if (listRaw) {
      try {
        const list = JSON.parse(listRaw) as unknown;
        if (Array.isArray(list)) {
          for (const entry of list) {
            if (
              entry &&
              typeof entry === 'object' &&
              'token' in entry &&
              typeof (entry as { token: unknown }).token === 'string'
            ) {
              tokens.add((entry as { token: string }).token);
            }
          }
        }
      } catch {
        /* ignore malformed active-sessions payload */
      }
    }
  }

  return [...tokens];
};

const refreshOneToken = async (
  redis: SessionSecondaryStorageRedis,
  token: string,
  dbUser: User
): Promise<boolean> => {
  const raw = await redis.get(token);
  if (!raw) {
    return false;
  }

  const parsed = safeJsonParse(raw);
  if (!parsed?.session || !parsed.user) return false;

  const ttl = await redis.ttl(token);
  const next = {
    session: parsed.session,
    user: { ...parsed.user, ...sessionUserFromDbRow(dbUser) },
  };
  const payload = JSON.stringify(next);

  if (ttl > 0) {
    await redis.set(token, payload, 'EX', ttl);
  } else if (ttl === -1) {
    await redis.set(token, payload);
  } else {
    await redis.set(token, payload, 'EX', 60 * 60 * 24 * 7);
  }
  return true;
};

/**
 * Updates Better Auth `secondaryStorage` session blobs for this user so embedded
 * `user` matches Postgres (e.g. after `PUT /users/:id`). Keys are the raw session
 * token string — see better-auth `internal-adapter.mjs` (`secondaryStorage.set(data.token, ...)`).
 */
const clearSessionSecondaryStorageForUserImpl = async (
  db: DbConnection,
  input: ClearSessionSecondaryStorageForUserInput,
  redis?: SessionSecondaryStorageRedis | null
): Promise<Result<ClearSessionSecondaryStorageForUserResponse>> => {
  const parsed = clearSessionSecondaryStorageForUserSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { userId } = parsed.data;

  try {
    const userResult = await getUser(db, { id: userId });
    if (!userResult.success) {
      const e = userResult.error;
      return err(new FeatureError(e.code, e.message, e.details));
    }

    if (!redis) {
      return ok({ refreshedCount: 0 });
    }

    const tokens = await collectSessionTokens(db, userId, redis);
    let refreshedCount = 0;
    const dbUser = userResult.data;

    for (const token of tokens) {
      try {
        const okRefresh = await refreshOneToken(redis, token, dbUser);
        if (okRefresh) refreshedCount += 1;
      } catch (redisError) {
        logError('auth.clearSessionSecondaryStorageForUser.token', redisError, {
          feature: 'auth',
          extra: { userId, tokenLen: token.length },
        });
      }
    }

    return ok({ refreshedCount });
  } catch (error) {
    logError('auth.clearSessionSecondaryStorageForUser', error, {
      feature: 'auth',
      extra: { userId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to refresh session secondary storage'
      )
    );
  }
};

export const clearSessionSecondaryStorageForUser = (
  db: DbConnection,
  input: ClearSessionSecondaryStorageForUserInput,
  redis?: SessionSecondaryStorageRedis | null
) =>
  trackedResult(
    'auth.clearSessionSecondaryStorageForUser',
    () => clearSessionSecondaryStorageForUserImpl(db, input, redis),
    { properties: { userId: input.userId } }
  );

export type ClearSessionSecondaryStorageForUserResult = Awaited<
  ReturnType<typeof clearSessionSecondaryStorageForUser>
>;
