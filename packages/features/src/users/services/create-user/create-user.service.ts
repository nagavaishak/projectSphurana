import { randomUUID } from 'node:crypto';
import { user } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CreateUserInput,
  createUserSchema,
} from './create-user.schema.js';

/**
 * Internal implementation of create user
 */
const createUserImpl = async (
  db: DbConnection,
  input: CreateUserInput
): Promise<Result<typeof result>> => {
  // Validate input
  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Check for existing user
  const existing = await db.query.user.findFirst({
    where: (user, { eq }) => eq(user.email, parsed.data.email),
  });

  if (existing) {
    return err(
      new FeatureError(
        ErrorCodes.ALREADY_EXISTS,
        `User with email ${parsed.data.email} already exists`,
        { email: parsed.data.email }
      )
    );
  }

  // Create user with generated ID
  const [result] = await db
    .insert(user)
    .values({
      id: randomUUID(),
      email: parsed.data.email,
      name: parsed.data.name,
    })
    .returning();

  return ok(result);
};

/**
 * Create a new user
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - User creation input
 * @returns Result with created user or error
 *
 * @example
 * ```ts
 * // Without transaction
 * const result = await createUser(db, {
 *   email: 'user@example.com',
 *   name: 'John Doe',
 * });
 *
 * // With transaction
 * await db.transaction(async (tx) => {
 *   const user = await createUser(tx, userInput);
 *   if (!user.success) throw new Error(user.error.message);
 *   // ... more operations with tx
 * });
 * ```
 */
export const createUser = (db: DbConnection, input: CreateUserInput) =>
  trackedResult('users.createUser', () => createUserImpl(db, input), {
    properties: { email: input.email },
  });

/**
 * Result type for createUser
 */
export type CreateUserResult = Awaited<ReturnType<typeof createUser>>;
