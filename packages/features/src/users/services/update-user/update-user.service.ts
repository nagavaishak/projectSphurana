import { user } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { syncPractitionerPhotoForUser } from '../../../practitioners/services/sync-practitioner-photo-for-user/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type UpdateUserInput,
  updateUserSchema,
} from './update-user.schema.js';

/**
 * Internal implementation of update user
 */
const updateUserImpl = async (
  db: DbConnection,
  input: UpdateUserInput
): Promise<Result<typeof result>> => {
  // Validate input
  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, ...updateData } = parsed.data;

  // Check if user exists
  const existing = await db.query.user.findFirst({
    where: (user, { eq }) => eq(user.id, id),
  });

  if (!existing) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, `User with ID ${id} not found`, {
        userId: id,
      })
    );
  }

  // Check email uniqueness if email is being updated
  const emailToCheck = updateData.email;
  if (emailToCheck && emailToCheck !== existing.email) {
    const emailExists = await db.query.user.findFirst({
      where: (user, { eq }) => eq(user.email, emailToCheck),
    });

    if (emailExists) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          `Email ${emailToCheck} is already in use`,
          { email: emailToCheck }
        )
      );
    }
  }

  // Update user
  const [result] = await db
    .update(user)
    .set({
      ...updateData,
      updatedAt: new Date(),
    })
    .where(eq(user.id, id))
    .returning();

  // The calendar and the public booking page render `practitioner.photo`, not
  // `user.image`, so mirror a new avatar onto the practitioner rows this user
  // owns. Routed through the practitioners feature, which owns writes to that
  // table. Best-effort: a failed mirror must not fail the profile save (it is
  // logged by the service), so the Result is intentionally not propagated.
  if ('image' in updateData) {
    await syncPractitionerPhotoForUser(db, {
      userId: id,
      photo: updateData.image ?? null,
    });
  }

  return ok(result);
};

/**
 * Update an existing user
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - User update input
 * @returns Result with updated user or error
 *
 * @example
 * ```ts
 * // Without transaction
 * const result = await updateUser(db, {
 *   id: 'user-123',
 *   name: 'Updated Name',
 * });
 *
 * // With transaction
 * await db.transaction(async (tx) => {
 *   const user = await updateUser(tx, input);
 *   if (!user.success) throw new Error(user.error.message);
 *   // ... more operations with tx
 * });
 * ```
 */
export const updateUser = (db: DbConnection, input: UpdateUserInput) =>
  trackedResult('users.updateUser', () => updateUserImpl(db, input), {
    properties: { userId: input.id },
  });

/**
 * Result type for updateUser
 */
export type UpdateUserResult = Awaited<ReturnType<typeof updateUser>>;
