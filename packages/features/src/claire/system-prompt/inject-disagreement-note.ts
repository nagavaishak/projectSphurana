import {
  type BusinessProfile,
  businessProfile,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../shared/index.js';
import { trackDisagreementSurfaced } from '../telemetry/index.js';

/**
 * Pure renderer for the disagreement system note.
 *
 * Returns `null` when there's no unresolved disagreement to surface
 * (no disagreement at all, or it's been resolved, or it's already been
 * surfaced once and the cooldown hasn't reset).
 */
export const renderDisagreementNote = (
  profile: BusinessProfile
): string | null => {
  const d = profile.disagreement;
  if (!d) return null;
  if (d.resolution !== 'pending') return null;
  if (d.surfaced) return null;

  const axesList = d.axes.join(', ');
  return [
    '## Important: classifier disagreement',
    `The owner has overridden the ${axesList} axis(es). Based on the services they offer,`,
    `the classifier would actually classify them differently (confidence ${d.classifierConfidence}).`,
    '',
    'If the conversation naturally touches on advertising or marketing strategy, bring this up',
    'ONCE in a non-pushy way — e.g. "Before I make a recommendation, I noticed you set your business as X,',
    'but based on your services I\'d actually classify you as Y. Want to revisit, or stick with what you set?".',
    'Do not raise it more than once per conversation.',
  ].join('\n');
};

/**
 * Build the disagreement note for an organization. Returns null when no
 * unsurfaced disagreement exists.
 *
 * Caller is expected to mark the disagreement surfaced AFTER Claire
 * actually raises it (via `markDisagreementSurfaced`) so subsequent
 * conversations don't keep re-raising the same point.
 */
const buildDisagreementNoteImpl = async (
  db: DbConnection,
  organizationId: string
): Promise<Result<string | null>> => {
  if (!organizationId) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'organizationId required')
    );
  }
  const row = await db.query.businessProfile.findFirst({
    where: eq(businessProfile.organizationId, organizationId),
  });
  if (!row) return ok(null);
  return ok(renderDisagreementNote(row));
};

export const buildDisagreementNote = (
  db: DbConnection,
  organizationId: string
) =>
  trackedResult(
    'claire.systemPrompt.buildDisagreementNote',
    () => buildDisagreementNoteImpl(db, organizationId),
    {
      properties: { organizationId },
      internalErrorsOnly: true,
    }
  );

export type BuildDisagreementNoteResult = Awaited<
  ReturnType<typeof buildDisagreementNote>
>;

/**
 * Mark the disagreement as surfaced so future system-prompt builds don't
 * re-raise it. Called from a tool (`resolve_disagreement`) once Claire
 * has either led the conversation or the operator has explicitly answered.
 */
const markDisagreementSurfacedImpl = async (
  db: DbConnection,
  organizationId: string
): Promise<Result<BusinessProfile>> => {
  if (!organizationId) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'organizationId required')
    );
  }
  const existing = await db.query.businessProfile.findFirst({
    where: eq(businessProfile.organizationId, organizationId),
  });
  if (!existing) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Business profile not found')
    );
  }
  if (!existing.disagreement) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'No disagreement on this profile.'
      )
    );
  }
  // Capture pre-update flag so we only fire the surfaced event on the
  // FIRST transition. Subsequent calls (e.g. dismissed → markSurfaced)
  // are no-ops for telemetry.
  const wasAlreadySurfaced = existing.disagreement.surfaced;
  const [updated] = await db
    .update(businessProfile)
    .set({
      disagreement: {
        ...existing.disagreement,
        surfaced: true,
        surfacedAt: new Date().toISOString(),
      },
    })
    .where(eq(businessProfile.id, existing.id))
    .returning();
  if (!updated) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to mark disagreement surfaced'
      )
    );
  }
  if (!wasAlreadySurfaced) {
    trackDisagreementSurfaced(organizationId, {
      surface: 'chat',
      axes: existing.disagreement.axes,
      classifierConfidence: existing.disagreement.classifierConfidence,
      ownerOverride: existing.overriddenAxes
        ? {
            retentionModel: existing.overriddenAxes.retentionModel,
            commitmentLevel: existing.overriddenAxes.commitmentLevel,
            marketPosition: existing.overriddenAxes.marketPosition,
          }
        : undefined,
      classifierProposal: existing.classifierAxes
        ? {
            retentionModel: existing.classifierAxes.retentionModel,
            commitmentLevel: existing.classifierAxes.commitmentLevel,
            marketPosition: existing.classifierAxes.marketPosition,
          }
        : undefined,
    });
  }
  return ok(updated);
};

export const markDisagreementSurfaced = (
  db: DbConnection,
  organizationId: string
) =>
  trackedResult(
    'claire.systemPrompt.markDisagreementSurfaced',
    () => markDisagreementSurfacedImpl(db, organizationId),
    { properties: { organizationId } }
  );

export type MarkDisagreementSurfacedResult = Awaited<
  ReturnType<typeof markDisagreementSurfaced>
>;
