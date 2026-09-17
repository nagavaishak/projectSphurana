/**
 * `regenerateAdCandidate` — per-card re-roll on the onboarding ad-picker.
 *
 * Reuses the existing standalone regenerate path (`regenerateGraphic`): a
 * fresh placeholder `graphic` row is inserted with the SOURCE's template
 * pinned, and a `render-only` job with the owner's `refinementInstruction`
 * is enqueued — so the change applies surgically instead of re-rolling the
 * design from scratch. Because a NEW graphic row is minted, the old id is
 * swapped for the new one in `session.adCandidateGraphicIds` so the slide's
 * grid keeps polling the right row.
 */

import { onboardingSession } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { regenerateGraphic } from '../../../graphics/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type RegenerateAdCandidateInput,
  type RegenerateAdCandidateOutput,
  regenerateAdCandidateSchema,
} from './regenerate-ad-candidate.schema.js';

const rewrap = (error: {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}): FeatureError => new FeatureError(error.code, error.message, error.details);

const regenerateAdCandidateImpl = async (
  db: DbConnection,
  input: RegenerateAdCandidateInput
): Promise<Result<RegenerateAdCandidateOutput>> => {
  const parsed = regenerateAdCandidateSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { userId, graphicId, prompt } = parsed.data;

  // ── 1. Load the session + preconditions ──────────────────────────────────
  const session = await db.query.onboardingSession.findFirst({
    where: eq(onboardingSession.userId, userId),
  });
  if (!session) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Onboarding session not found')
    );
  }
  if (!session.organizationId) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'Onboarding session has no organization yet'
      )
    );
  }
  const candidates = session.adCandidateGraphicIds ?? [];
  if (!candidates.includes(graphicId)) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        "Graphic is not one of this session's ad candidates"
      )
    );
  }

  // ── 2. Re-roll via the existing regenerate path ──────────────────────────
  const regenerated = await regenerateGraphic(db, {
    organizationId: session.organizationId,
    graphicId,
    createdById: userId,
    refinementInstruction: prompt,
    scope: 'all',
  });
  if (!regenerated.success) {
    return err(rewrap(regenerated.error));
  }
  const newGraphicId = regenerated.data.id;

  // ── 3. Swap the candidate id on the session ──────────────────────────────
  if (newGraphicId !== graphicId) {
    const updatedIds = candidates.map((id) =>
      id === graphicId ? newGraphicId : id
    );
    try {
      await db
        .update(onboardingSession)
        .set({ adCandidateGraphicIds: updatedIds })
        .where(eq(onboardingSession.userId, userId));
    } catch (error) {
      logError('onboarding.regenerateAdCandidate.updateSession', error, {
        feature: 'onboarding',
        extra: { userId, graphicId, newGraphicId },
      });
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to swap the regenerated candidate on the onboarding session'
        )
      );
    }
  }

  return ok({ graphicId: newGraphicId });
};

export const regenerateAdCandidate = (
  db: DbConnection,
  input: RegenerateAdCandidateInput
) =>
  trackedResult(
    'onboarding.regenerateAdCandidate',
    () => regenerateAdCandidateImpl(db, input),
    {
      properties: { userId: input.userId, graphicId: input.graphicId },
    }
  );

export type RegenerateAdCandidateResult = Awaited<
  ReturnType<typeof regenerateAdCandidate>
>;
