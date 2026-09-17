import {
  type OnboardingSession,
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
  type UpdateOnboardingSessionInput,
  updateOnboardingSessionSchema,
} from './update-onboarding-session.schema.js';

const updateOnboardingSessionImpl = async (
  db: DbConnection,
  input: UpdateOnboardingSessionInput
): Promise<Result<OnboardingSession>> => {
  const parsed = updateOnboardingSessionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { userId, currentSlide, answer } = parsed.data;
  let { selectedGraphicIds, selectedVideoId } = parsed.data;
  let servicePriceCents: number | undefined;
  let contentSource: 'upload' | 'stock' | undefined;

  // The slide deck records picker selections as slide ANSWERS while the
  // launch orchestrator reads the dedicated columns. Lift the selection out
  // of the answer payload so a plain answer round-trip persists both — the
  // explicit top-level fields (when sent) win.
  if (answer && typeof answer.value === 'object' && answer.value !== null) {
    const value = answer.value as Record<string, unknown>;
    if (
      selectedGraphicIds === undefined &&
      answer.slide === 'ad_picker' &&
      Array.isArray(value.selectedGraphicIds) &&
      value.selectedGraphicIds.every((id) => typeof id === 'string')
    ) {
      selectedGraphicIds = value.selectedGraphicIds as string[];
    }
    if (
      selectedVideoId === undefined &&
      answer.slide === 'video_picker' &&
      typeof value.selectedVideoId === 'string' &&
      value.selectedVideoId.length > 0
    ) {
      selectedVideoId = value.selectedVideoId;
    }
    // The typed base price feeds suggestIntroOffer's discount computation —
    // accept-intro-offer reads the COLUMN, so lift it out of the answer.
    if (
      answer.slide === 'service_price' &&
      typeof value.servicePriceCents === 'number' &&
      Number.isFinite(value.servicePriceCents) &&
      value.servicePriceCents > 0
    ) {
      servicePriceCents = Math.round(value.servicePriceCents);
    }
    if (
      answer.slide === 'content_source' &&
      (value.contentSource === 'upload' || value.contentSource === 'stock')
    ) {
      contentSource = value.contentSource;
    }
  }

  let session = await db.query.onboardingSession.findFirst({
    where: eq(onboardingSession.userId, userId),
  });

  // Upsert: the first slide interaction may arrive before any other endpoint
  // created the session (e.g. skipping the website slide).
  if (!session) {
    try {
      [session] = await db
        .insert(onboardingSession)
        .values({ userId })
        .returning();
    } catch (error) {
      logError('onboarding.updateOnboardingSession', error, {
        feature: 'onboarding',
        extra: { userId },
      });
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to create onboarding session'
        )
      );
    }
  }

  if (session.status !== 'active') {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'Onboarding session is no longer active'
      )
    );
  }

  try {
    const answers = answer
      ? { ...(session.answers ?? {}), [answer.slide]: answer.value }
      : undefined;

    const [updated] = await db
      .update(onboardingSession)
      .set({
        ...(currentSlide ? { currentSlide } : {}),
        ...(answers ? { answers } : {}),
        ...(selectedGraphicIds !== undefined ? { selectedGraphicIds } : {}),
        ...(selectedVideoId !== undefined ? { selectedVideoId } : {}),
        ...(servicePriceCents !== undefined ? { servicePriceCents } : {}),
        ...(contentSource !== undefined ? { contentSource } : {}),
      })
      .where(eq(onboardingSession.id, session.id))
      .returning();

    return ok(updated);
  } catch (error) {
    logError('onboarding.updateOnboardingSession', error, {
      feature: 'onboarding',
      extra: { userId, currentSlide },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update onboarding session'
      )
    );
  }
};

/** User-scoped (pre-org) — see getOnboardingSession for the scope rationale. */
export const updateOnboardingSession = (
  db: DbConnection,
  input: UpdateOnboardingSessionInput
) =>
  trackedResult(
    'onboarding.updateOnboardingSession',
    () =>
      withSystemScope((tx) => updateOnboardingSessionImpl(tx, input), { db }),
    {
      properties: { userId: input.userId, currentSlide: input.currentSlide },
      internalErrorsOnly: true,
    }
  );

export type UpdateOnboardingSessionResult = Awaited<
  ReturnType<typeof updateOnboardingSession>
>;
