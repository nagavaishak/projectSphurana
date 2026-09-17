import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { type GetUserInput, getUserSchema } from './get-user.schema.js';

/**
 * Internal implementation of get user
 */
const getUserImpl = async (
  db: DbConnection,
  input: GetUserInput
): Promise<Result<NonNullable<typeof result>>> => {
  // Validate input
  const parsed = getUserSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id } = parsed.data;

  // Find user
  const result = await db.query.user.findFirst({
    where: (user, { eq }) => eq(user.id, id),
  });

  if (!result) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, `User with ID ${id} not found`, {
        userId: id,
      })
    );
  }

  return ok(result);
};

/**
 * Get a user by ID
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - User ID input
 * @returns Result with user or error
 *
 * @example
 * ```ts
 * const result = await getUser(db, { id: 'user-123' });
 *
 * if (result.success) {
 *   console.log('User:', result.data);
 * } else {
 *   console.error('Error:', result.error.message);
 * }
 * ```
 */
export const getUser = (db: DbConnection, input: GetUserInput) =>
  trackedResult('users.getUser', () => getUserImpl(db, input), {
    properties: { userId: input.id },
    internalErrorsOnly: true,
  });

/**
 * Result type for getUser
 */
export type GetUserResult = Awaited<ReturnType<typeof getUser>>;
