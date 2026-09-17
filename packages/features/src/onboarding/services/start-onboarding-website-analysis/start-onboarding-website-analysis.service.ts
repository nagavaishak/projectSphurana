import {
  onboardingSession,
  withSystemScope,
} from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
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
import { startAnalyzeWebsiteJob } from '../../../website-analysis/services/analyze-website/analyze-website.service.js';
import { getOnboardingSession } from '../get-onboarding-session/get-onboarding-session.service.js';
import {
  type StartOnboardingWebsiteAnalysisInput,
  startOnboardingWebsiteAnalysisSchema,
} from './start-onboarding-website-analysis.schema.js';

/**
 * Redis job-scoping key for pre-org analysis. `startAnalyzeWebsiteJob` scopes
 * jobs by an "organizationId" string purely for tenant-safe polling; before
 * the organization exists we scope by the user instead. The onboarding
 * controller polls with the SAME key, so users can only read their own jobs.
 */
export const onboardingAnalysisScopeKey = (userId: string) => `user:${userId}`;

const startOnboardingWebsiteAnalysisImpl = async (
  db: DbConnection,
  input: StartOnboardingWebsiteAnalysisInput
): Promise<Result<{ jobId: string }>> => {
  const parsed = startOnboardingWebsiteAnalysisSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { userId, websiteUrl } = parsed.data;

  // Ensure the session exists (this is the first slide — lazily creates).
  // trackedResult widens the error to a plain shape — rewrap as FeatureError.
  const sessionResult = await getOnboardingSession(db, {
    userId,
    createIfMissing: true,
  });
  if (!sessionResult.success) {
    return err(
      new FeatureError(
        sessionResult.error.code as never,
        sessionResult.error.message
      )
    );
  }
  const session = sessionResult.data;
  if (!session) {
    // Unreachable with createIfMissing default true — narrow for types
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Onboarding session missing after ensure'
      )
    );
  }

  // The GPT-extraction key is a PARAMETER of the analysis job, not read from
  // env inside it — the website-analysis controller does the same.
  const apiKey = apiEnv.OPENAI_API_KEY;
  if (!apiKey) {
    return err(
      new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'OpenAI API key not configured'
      )
    );
  }

  // Kick the analysis BEFORE writing the session so a queue failure doesn't
  // strand a jobId that never existed. Analysis is external I/O — never
  // wrapped in a DB transaction.
  const jobResult = await startAnalyzeWebsiteJob(
    {
      websiteUrl,
      organizationId: onboardingAnalysisScopeKey(userId),
    },
    apiKey
  );
  if (!jobResult.success) return jobResult;

  try {
    await db
      .update(onboardingSession)
      .set({
        websiteUrl,
        analysisJobId: jobResult.data.jobId,
        currentSlide: 'intro',
      })
      .where(eq(onboardingSession.id, session.id));

    return ok({ jobId: jobResult.data.jobId });
  } catch (error) {
    logError('onboarding.startOnboardingWebsiteAnalysis', error, {
      feature: 'onboarding',
      extra: { userId, websiteUrl },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to start website analysis'
      )
    );
  }
};

/** User-scoped (pre-org, pre-email-verification) — system scope, see getOnboardingSession. */
export const startOnboardingWebsiteAnalysis = (
  db: DbConnection,
  input: StartOnboardingWebsiteAnalysisInput
) =>
  trackedResult(
    'onboarding.startOnboardingWebsiteAnalysis',
    () =>
      withSystemScope((tx) => startOnboardingWebsiteAnalysisImpl(tx, input), {
        db,
      }),
    { properties: { userId: input.userId, websiteUrl: input.websiteUrl } }
  );

export type StartOnboardingWebsiteAnalysisResult = Awaited<
  ReturnType<typeof startOnboardingWebsiteAnalysis>
>;
