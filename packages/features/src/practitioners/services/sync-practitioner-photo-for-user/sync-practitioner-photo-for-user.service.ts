import { practitioner } from '@borradh-workspace/database';
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
  type SyncPractitionerPhotoForUserInput,
  syncPractitionerPhotoForUserSchema,
} from './sync-practitioner-photo-for-user.schema.js';

/**
 * Mirror a user's account avatar (`user.image`) onto every practitioner record
 * they own (`practitioner.photo`).
 *
 * The two columns are deliberately separate — a practitioner can exist with no
 * user account at all (staff added or invited but not yet joined), and the
 * photo is org-scoped and client-facing. But the calendar and the public
 * booking page render `practitioner.photo`, so when someone changes their OWN
 * profile photo we mirror it across their practitioner rows (they may be staff
 * at more than one org) — otherwise the new photo would only ever show in the
 * account menu.
 *
 * Not org-scoped on purpose: the sync follows the person, not a single tenant.
 */
const syncPractitionerPhotoForUserImpl = async (
  db: DbConnection,
  input: SyncPractitionerPhotoForUserInput
): Promise<Result<{ updated: number }>> => {
  const parsed = syncPractitionerPhotoForUserSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { userId, photo } = parsed.data;

  try {
    const updated = await db
      .update(practitioner)
      .set({ photo, updatedAt: new Date() })
      .where(eq(practitioner.userId, userId))
      .returning({ id: practitioner.id });

    return ok({ updated: updated.length });
  } catch (error) {
    logError('practitioners.syncPractitionerPhotoForUser', error, {
      feature: 'practitioners',
      extra: { userId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to sync practitioner photo'
      )
    );
  }
};

export const syncPractitionerPhotoForUser = (
  db: DbConnection,
  input: SyncPractitionerPhotoForUserInput
) =>
  trackedResult(
    'practitioners.syncPractitionerPhotoForUser',
    () => syncPractitionerPhotoForUserImpl(db, input),
    { properties: { userId: input.userId } }
  );

export type SyncPractitionerPhotoForUserResult = Awaited<
  ReturnType<typeof syncPractitionerPhotoForUser>
>;
