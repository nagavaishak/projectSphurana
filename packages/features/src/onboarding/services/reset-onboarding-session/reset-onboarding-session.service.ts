import {
  type OnboardingSession,
  onboardingSession,
  withSystemScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { deleteOrganization } from '../../../organizations/services/delete-organization/delete-organization.service.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ResetOnboardingSessionInput,
  resetOnboardingSessionSchema,
} from './reset-onboarding-session.schema.js';

/**
 * Full "as if new" reset — rewind the session to the first slide AND
 * (soft-)delete the organization the flow created, so the user walks the
 * ENTIRE flow again from scratch. Soft-deleting the org (rather than hard
 * cascade) drops their active-org count to zero — the next apply-analysis
 * mints a brand-new org with a fresh slug — while keeping this session row
 * intact (the FK cascade would otherwise take it with the org).
 *
 * Clears every flow field: slide pointer, answers, conversation, analysis
 * snapshot, service/price/offer, content + creative + campaign selections,
 * and the launch marker. Org deletion is best-effort — a missing/already
 * deleted org never blocks the reset.
 */
const resetOnboardingSessionImpl = async (
  db: DbConnection,
  input: ResetOnboardingSessionInput
): Promise<Result<OnboardingSession>> => {
  const parsed = resetOnboardingSessionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { userId } = parsed.data;

  const session = await db.query.onboardingSession.findFirst({
    where: eq(onboardingSession.userId, userId),
  });

  // No session yet (e.g. they hit "Start over" on the very first slide before
  // any mutation created one) → nothing to reset; mint a fresh one at intro so
  // the caller always gets a clean session back. Idempotent.
  if (!session) {
    try {
      const [created] = await db
        .insert(onboardingSession)
        .values({ userId })
        .returning();
      return ok(created);
    } catch (error) {
      logError('onboarding.resetOnboardingSession', error, {
        feature: 'onboarding',
        extra: { userId },
      });
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to reset onboarding session'
        )
      );
    }
  }

  // Soft-delete the org the flow created so the user lands exactly where a
  // fresh sign-up does (zero active orgs). Best-effort + its own scope — a
  // missing/already-deleted org must never block the reset, and org deletion
  // must not share this function's DB scope (it runs its own withOrgScope).
  if (session.organizationId) {
    const deleted = await deleteOrganization(db, {
      organizationId: session.organizationId,
      requesterId: userId,
    });
    if (!deleted.success && deleted.error.code !== ErrorCodes.NOT_FOUND) {
      logError(
        'onboarding.resetOnboardingSession.deleteOrg',
        new Error(deleted.error.message),
        { feature: 'onboarding', extra: { userId, code: deleted.error.code } }
      );
    }
  }

  try {
    const [updated] = await db
      .update(onboardingSession)
      .set({
        status: 'active',
        currentSlide: 'intro',
        organizationId: null,
        answers: null,
        conversationTurns: null,
        websiteUrl: null,
        analysisJobId: null,
        analysisResult: null,
        contentSource: null,
        contentBatchId: null,
        selectedServiceId: null,
        servicePriceCents: null,
        offerId: null,
        adCandidateGraphicIds: null,
        selectedGraphicIds: null,
        videoCandidateIds: null,
        selectedVideoId: null,
        stagedCampaign: null,
        metaCampaignId: null,
        launchedAt: null,
      })
      .where(eq(onboardingSession.id, session.id))
      .returning();

    return ok(updated);
  } catch (error) {
    logError('onboarding.resetOnboardingSession', error, {
      feature: 'onboarding',
      extra: { userId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to reset onboarding session'
      )
    );
  }
};

/** User-scoped (org may exist by now) — see getOnboardingSession for scope. */
export const resetOnboardingSession = (
  db: DbConnection,
  input: ResetOnboardingSessionInput
) =>
  trackedResult(
    'onboarding.resetOnboardingSession',
    () =>
      withSystemScope((tx) => resetOnboardingSessionImpl(tx, input), { db }),
    { properties: { userId: input.userId } }
  );

export type ResetOnboardingSessionResult = Awaited<
  ReturnType<typeof resetOnboardingSession>
>;
