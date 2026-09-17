import type { OnboardingSession } from '@borradh-workspace/database';
import { onboardingSession, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
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
  type CompleteOnboardingSessionInput,
  completeOnboardingSessionSchema,
} from './complete-onboarding-session.schema.js';

/**
 * Internal implementation — marks the user's onboarding session completed.
 * Idempotent: completing an already-completed session is a no-op success.
 */
const completeOnboardingSessionImpl = async (
  db: DbConnection,
  input: CompleteOnboardingSessionInput
): Promise<Result<OnboardingSession>> => {
  const parsed = completeOnboardingSessionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const [updated] = await withOrgScope(
    (tx) =>
      tx
        .update(onboardingSession)
        .set({ status: 'completed' })
        .where(eq(onboardingSession.userId, parsed.data.userId))
        .returning(),
    { db }
  );

  if (!updated) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Onboarding session not found')
    );
  }

  return ok(updated);
};

/**
 * Mark the onboarding session completed (the final slide).
 */
export const completeOnboardingSession = (
  db: DbConnection,
  input: CompleteOnboardingSessionInput
) =>
  trackedResult(
    'onboarding.completeOnboardingSession',
    () => completeOnboardingSessionImpl(db, input),
    { properties: { userId: input.userId } }
  );

export type CompleteOnboardingSessionResult = Awaited<
  ReturnType<typeof completeOnboardingSession>
>;
