import {
  and,
  db,
  eq,
  isNull,
  onboardingSession,
  withSystemScope,
} from '@borradh-workspace/database';
import {
  DEFAULT_BATCH_GRAPHIC_COUNT,
  DEFAULT_BATCH_VIDEO_COUNT,
  requestMonthlyBatch,
} from '@borradh-workspace/features/content-batches';
import {
  generateAdCandidates,
  generateVideoCandidates,
  getOnboardingSession,
} from '@borradh-workspace/features/onboarding';
import {
  ErrorCodes,
  FeatureError,
  err,
  ok,
} from '@borradh-workspace/features/shared';
// NOTE: `ResultShape`, not `Result`. Services exported through `trackedResult`
// return the former — a structurally-compatible clone whose error is a plain
// object rather than a FeatureError instance — so a function that forwards
// their failures cannot be typed as `Result<T>`. This is the second place in
// this change where that distinction cost a build.
import type { ResultShape } from '@borradh-workspace/observability';
import type { Logger } from '@nestjs/common';

/**
 * Best-effort writes and fire-and-forget work hung off the onboarding session.
 *
 * All three were private methods on `OnboardingController` (28 + 31 lines of
 * helper, plus a third copy of the same try/catch inline in a handler). None is
 * transport: two are database writes and one is background job kickoff.
 *
 * WHAT UNIFIES THEM: every one is NON-FATAL. The request that triggers them has
 * already succeeded, and a failure here must never turn that into an error
 * response — the poll retries, or the approval slide finds the batch by org
 * instead. That is why they swallow rather than propagate, and why they log at
 * WARN rather than ERROR.
 */

function warnFailure(
  logger: Logger,
  what: string,
  userId: string,
  error: unknown
) {
  logger.warn(
    `${what} for user ${userId}: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
}

/**
 * Write the finished analysis snapshot onto the session (once — the
 * `isNull` guard makes repeated polls a no-op). A small direct update:
 * `updateOnboardingSession` only handles slide/answer fields, and the
 * snapshot must land in the `analysisResult` column. Failure to persist is
 * non-fatal for the poll itself (the next poll retries).
 */
export async function persistAnalysisSnapshot(
  logger: Logger,
  userId: string,
  jobId: string,
  snapshot: Record<string, unknown>
): Promise<void> {
  try {
    await withSystemScope(
      (tx) =>
        tx
          .update(onboardingSession)
          .set({ analysisResult: snapshot })
          .where(
            and(
              eq(onboardingSession.userId, userId),
              eq(onboardingSession.analysisJobId, jobId),
              isNull(onboardingSession.analysisResult)
            )
          ),
      { db }
    );
  } catch (error) {
    warnFailure(logger, 'Failed to persist analysis snapshot', userId, error);
  }
}

/**
 * Remember the content batch on the session — best-effort, because the
 * approval slide can also find the current batch by org.
 */
export async function persistContentBatchId(
  logger: Logger,
  userId: string,
  batchId: string
): Promise<void> {
  try {
    await withSystemScope(
      (tx) =>
        tx
          .update(onboardingSession)
          .set({ contentBatchId: batchId })
          .where(eq(onboardingSession.userId, userId)),
      { db }
    );
  } catch (error) {
    warnFailure(logger, 'Failed to persist content batch id', userId, error);
  }
}

/** Fire-and-forget the two candidate generators; never blocks a response. */
export function kickCandidateGeneration(logger: Logger, userId: string): void {
  void generateVideoCandidates(db, { userId })
    .then((r) => {
      if (!r.success) {
        logger.warn(
          `Background video-candidate generation failed for user ${userId}: ${r.error.code} - ${r.error.message}`
        );
      }
    })
    .catch((error) => {
      logger.error(
        `Background video-candidate generation threw for user ${userId}`,
        error instanceof Error ? error.stack : String(error)
      );
    });

  void generateAdCandidates(db, { userId })
    .then((r) => {
      if (!r.success) {
        logger.warn(
          `Background ad-candidate generation failed for user ${userId}: ${r.error.code} - ${r.error.message}`
        );
      }
    })
    .catch((error) => {
      logger.error(
        `Background ad-candidate generation threw for user ${userId}`,
        error instanceof Error ? error.stack : String(error)
      );
    });
}

/**
 * Kick the month-of-content generation for the content_source slide.
 *
 * Idempotent: `requestMonthlyBatch` no-ops on an existing batch for the month.
 * The heavy seeding is fire-and-forget server-side; the content-approval slide
 * polls the batch as usual.
 *
 * Lives here rather than in the handler because it is four sequential decisions
 * (resolve session → require an org → request the batch → record the id), which
 * is orchestration by any reading of Gate 5. It returned to the controller once
 * after a formatter reflow pushed the body back over the threshold — a useful
 * reminder that the gate measures the file as it is on disk, not as it was
 * written.
 */
export async function startOnboardingContentBatch(
  logger: Logger,
  userId: string
): Promise<ResultShape<{ batchId: string; queued: unknown }>> {
  const session = await getOnboardingSession(db, {
    userId,
    createIfMissing: false,
  });
  if (!session.success) return session;

  const organizationId = session.data?.organizationId;
  if (!organizationId) {
    return err(
      new FeatureError(ErrorCodes.CONFLICT, 'Organization not created yet')
    );
  }

  // `allowStockFootage`: a brand-new org typically has no uploaded media yet,
  // and without stock the batch preflight dead-ends. Owner uploads still take
  // priority over stock at render time.
  const result = await requestMonthlyBatch(db, {
    organizationId,
    graphicCount: DEFAULT_BATCH_GRAPHIC_COUNT,
    videoCount: DEFAULT_BATCH_VIDEO_COUNT,
    createdById: userId,
    allowStockFootage: true,
  });
  if (!result.success) return result;

  await persistContentBatchId(logger, userId, result.data.batch.id);
  return ok({ batchId: result.data.batch.id, queued: result.data.queued });
}
