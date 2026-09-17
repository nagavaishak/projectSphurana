import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type SessionSecondaryStorageRedis,
  clearSessionSecondaryStorageForUser,
} from '../../../auth/index.js';
import type { DbConnection } from '../../../shared/index.js';
import { updateUser } from '../update-user/update-user.service.js';
import type { UpdateUserProfileInput } from './update-user-profile.schema.js';

/**
 * Save a user's own profile and keep their live sessions in step with it.
 *
 * Better Auth serves the session (and the `user` blob embedded in it) from
 * Redis secondary storage, so a profile save that only touched Postgres would
 * leave every open tab showing the old name/avatar until the session expired.
 *
 * The cache refresh is best-effort: it is logged and swallowed, never
 * propagated, because the write itself already succeeded and failing the
 * request would tell the user their save did not land when it did.
 */
const updateUserProfileImpl = async (
  db: DbConnection,
  input: UpdateUserProfileInput,
  redis?: SessionSecondaryStorageRedis | null
) => {
  const result = await updateUser(db, input);

  if (!result.success) {
    return result;
  }

  const cacheResult = await clearSessionSecondaryStorageForUser(
    db,
    { userId: input.id },
    redis ?? null
  );

  if (!cacheResult.success) {
    logError('users.updateUserProfile.sessionCache', cacheResult.error, {
      feature: 'users',
      extra: { userId: input.id, code: cacheResult.error.code },
    });
  }

  return result;
};

export const updateUserProfile = (
  db: DbConnection,
  input: UpdateUserProfileInput,
  redis?: SessionSecondaryStorageRedis | null
) =>
  trackedResult(
    'users.updateUserProfile',
    () => updateUserProfileImpl(db, input, redis),
    { properties: { userId: input.id } }
  );

export type UpdateUserProfileResult = Awaited<
  ReturnType<typeof updateUserProfile>
>;
