import {
  onboardingSession,
  withSystemScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import {
  type CreateOrganizationInput,
  createOrganization,
  type createOrganizationSchema,
} from '../../../organizations/services/create-organization/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { applyWebsiteAnalysis } from '../../../website-analysis/index.js';
import {
  type AnalysisSnapshot,
  type ApplyAnalysisToOrganizationInput,
  type ApplyAnalysisToOrganizationOutput,
  analysisSnapshotSchema,
  applyAnalysisToOrganizationSchema,
} from './apply-analysis-to-organization.schema.js';

/** Matches createOrganizationSchema's hex validation — the analysis colors are
 * free-form strings, so anything non-hex is dropped rather than failing the
 * whole bootstrap. */
const hexColorPattern = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

const asHexColor = (value: string | undefined): string | undefined =>
  value && hexColorPattern.test(value) ? value : undefined;

/**
 * Organization name: business name / site title from the analysis snapshot,
 * falling back to the website domain ("https://www.glowclinic.ie/…" →
 * "Glowclinic"). Null when neither source is usable.
 */
const deriveOrganizationName = (
  snapshot: AnalysisSnapshot,
  websiteUrl: string | null
): string | null => {
  const explicit = snapshot.businessName ?? snapshot.siteTitle;
  if (explicit?.trim()) return explicit.trim().slice(0, 100);

  if (!websiteUrl) return null;
  try {
    const host = new URL(websiteUrl).hostname.replace(/^www\./i, '');
    const label = host.split('.')[0];
    if (!label) return null;
    return (label.charAt(0).toUpperCase() + label.slice(1)).slice(0, 100);
  } catch {
    return null;
  }
};

/**
 * Bootstrap the organization from the onboarding session's website-analysis
 * snapshot — the post-email-verification replacement for the old wizard's
 * manual steps. Creates the org (reusing `createOrganization`), then hands the
 * snapshot to `applyWebsiteAnalysis` — the SAME engine the Settings rescan uses
 * — to persist services, the venue address and its booking-page description,
 * opening hours, staff and packages. Finally links the session to the new org.
 *
 * Idempotent: if the session already carries an organizationId the call
 * returns it untouched (resume / double-submit safe).
 */
const applyAnalysisToOrganizationImpl = async (
  db: DbConnection,
  input: ApplyAnalysisToOrganizationInput
): Promise<Result<ApplyAnalysisToOrganizationOutput>> => {
  const parsed = applyAnalysisToOrganizationSchema.safeParse(input);
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
  if (!session) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Onboarding session not found')
    );
  }

  // Already applied — the org exists and is linked. Never create a second one.
  if (session.organizationId) {
    return ok({
      organizationId: session.organizationId,
      createdServiceIds: [],
    });
  }

  // Lenient parse: a thin/absent snapshot degrades field-by-field (every field
  // has .catch), so this only fails if the stored value isn't an object at all.
  const snapshotParsed = analysisSnapshotSchema.safeParse(
    session.analysisResult ?? {}
  );
  const snapshot: AnalysisSnapshot = snapshotParsed.success
    ? snapshotParsed.data
    : analysisSnapshotSchema.parse({});

  const name = deriveOrganizationName(snapshot, session.websiteUrl);
  if (!name) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'Onboarding session has no analysis result or website URL to derive an organization name from'
      )
    );
  }

  // Create the organization via the existing service — only fields BOTH the
  // analysis snapshot and createOrganization support are mapped. businessType
  // is not analyzable, so it defaults to 'other' (refined in settings later).
  // Typed against the schema's INPUT shape (defaults still unapplied); the
  // cast bridges to the service's parameter type, which is the parsed OUTPUT
  // shape — createOrganization safeParses this again internally.
  const orgInput: z.input<typeof createOrganizationSchema> = {
    name,
    businessType: 'other',
    createdByUserId: userId,
    websiteUrl: session.websiteUrl ?? undefined,
    logo: snapshot.logoUrl ?? undefined,
    brandVoice: snapshot.brandVoice ?? [],
    targetAudienceDescription: snapshot.targetAudienceDescription ?? undefined,
    primaryColor: asHexColor(snapshot.primaryColor),
    secondaryColor: asHexColor(snapshot.secondaryColor),
    businessHours:
      snapshot.businessHours && Object.keys(snapshot.businessHours).length > 0
        ? snapshot.businessHours
        : undefined,
  };
  const orgResult = await createOrganization(
    db,
    orgInput as CreateOrganizationInput
  );
  if (!orgResult.success) {
    // createOrganization is trackedResult-wrapped, so its error is the
    // structural { code, message, details } shape — re-wrap as a FeatureError.
    return err(
      new FeatureError(
        orgResult.error.code,
        orgResult.error.message,
        orgResult.error.details
      )
    );
  }
  const organizationId = orgResult.data.id;

  // Persist everything the scan found onto the fresh org. Best-effort by
  // design: a single failed row never fails the bootstrap — the owner can add
  // it from the dashboard, and applyWebsiteAnalysis reports what it skipped.
  // No `modes`: the defaults are the additive ones, and on a brand-new org
  // there is nothing for `replace` to deactivate anyway.
  const applied = await applyWebsiteAnalysis(db, {
    organizationId,
    analysis: session.analysisResult ?? {},
  });
  const createdServiceIds = applied.success
    ? applied.data.createdServiceIds
    : [];

  // Link the session to the org (progress marker — the idempotency guard
  // above keys off this, so a retry after this point is a no-op).
  try {
    await db
      .update(onboardingSession)
      .set({ organizationId })
      .where(eq(onboardingSession.id, session.id));
  } catch (error) {
    logError('onboarding.applyAnalysisToOrganization', error, {
      feature: 'onboarding',
      extra: { userId, organizationId, sessionId: session.id },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Organization was created but the onboarding session could not be updated'
      )
    );
  }

  return ok({ organizationId, createdServiceIds });
};

/** User-scoped (pre-org) — see getOnboardingSession for the scope rationale. */
export const applyAnalysisToOrganization = (
  db: DbConnection,
  input: ApplyAnalysisToOrganizationInput
) =>
  trackedResult(
    'onboarding.applyAnalysisToOrganization',
    () =>
      withSystemScope((tx) => applyAnalysisToOrganizationImpl(tx, input), {
        db,
      }),
    {
      properties: { userId: input.userId },
      internalErrorsOnly: true,
    }
  );

export type ApplyAnalysisToOrganizationResult = Awaited<
  ReturnType<typeof applyAnalysisToOrganization>
>;
