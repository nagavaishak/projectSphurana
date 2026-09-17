import {
  type OnboardingSession,
  isUniqueViolation,
  onboardingSession,
  withSystemScope,
} from '@borradh-workspace/database';
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
  type GetOnboardingSessionInput,
  getOnboardingSessionSchema,
} from './get-onboarding-session.schema.js';

/**
 * Get (or lazily create) the user's onboarding session.
 *
 * One session per user — created the first time this is called (the website
 * slide, which happens BEFORE email verification and before any organization
 * exists). All later slides read/advance the same row, which is what makes
 * close-the-tab → resume-on-next-login work.
 */
const getOnboardingSessionImpl = async (
  db: DbConnection,
  input: GetOnboardingSessionInput
): Promise<Result<OnboardingSession | null>> => {
  const parsed = getOnboardingSessionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { userId, createIfMissing } = parsed.data;

  try {
    const existing = await db.query.onboardingSession.findFirst({
      where: eq(onboardingSession.userId, userId),
    });
    if (existing) return ok(existing);
    if (!createIfMissing) return ok(null);

    // First touch — create. The unique index on user_id makes a concurrent
    // double-create race resolve to a conflict; re-read on that path.
    try {
      const [created] = await db
        .insert(onboardingSession)
        .values({ userId })
        .returning();
      return ok(created);
    } catch (error) {
      // drizzle wraps the postgres.js error — the constraint lives on the
      // `.cause` chain, not `error.message` (see isUniqueViolation).
      if (isUniqueViolation(error, 'uniq_onboarding_session_user')) {
        const raced = await db.query.onboardingSession.findFirst({
          where: eq(onboardingSession.userId, userId),
        });
        if (raced) return ok(raced);
      }
      throw error;
    }
  } catch (error) {
    logError('onboarding.getOnboardingSession', error, {
      feature: 'onboarding',
      extra: { userId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to load onboarding session'
      )
    );
  }
};

/**
 * User-scoped (pre-org) — runs under system scope because withOrgScope
 * requires an organization context and none exists yet at the start of
 * onboarding. Every query filters by userId explicitly; the table's
 * user_isolation RLS policy additionally protects authenticated-role access.
 */
export const getOnboardingSession = (
  db: DbConnection,
  input: GetOnboardingSessionInput
) =>
  trackedResult(
    'onboarding.getOnboardingSession',
    () => withSystemScope((tx) => getOnboardingSessionImpl(tx, input), { db }),
    { properties: { userId: input.userId }, internalErrorsOnly: true }
  );

export type GetOnboardingSessionResult = Awaited<
  ReturnType<typeof getOnboardingSession>
>;
