import {
  type BusinessProfile,
  type BusinessVertical,
  type ClassifierAxes,
  type Disagreement,
  type OverriddenAxes,
  businessProfile,
  organization,
  organizationService,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  composeFromSelection,
  composeRecommendation,
  computeInputHash,
} from '../../recommendation-engine/index.js';
import {
  type ClassifierRunReason,
  trackClassifierDisagreementDetected,
  trackClassifierFailed,
  trackClassifierRun,
} from '../../telemetry/index.js';
import { getVerticalConfig } from '../../verticals/registry.js';
import type { AxisOverrides } from '../../verticals/types.js';
import {
  type ClassifyBusinessInput,
  classifyBusinessSchema,
} from './classify-business.schema.js';

// Confidence threshold below which the classifier defers to the owner
// override without raising a disagreement. Keep in sync with Decision #4
// in the master plan.
const DISAGREEMENT_CONFIDENCE_THRESHOLD = 0.8;

const computeDisagreement = (
  classifierUnconstrained: ClassifierAxes,
  overrides: OverriddenAxes | null
): Disagreement | null => {
  if (!overrides) return null;
  if (classifierUnconstrained.confidence < DISAGREEMENT_CONFIDENCE_THRESHOLD) {
    return null;
  }

  const disagreeingAxes: Array<
    'retentionModel' | 'commitmentLevel' | 'marketPosition'
  > = [];
  for (const axis of [
    'retentionModel',
    'commitmentLevel',
    'marketPosition',
  ] as const) {
    const overrideValue = overrides[axis];
    if (overrideValue && classifierUnconstrained[axis] !== overrideValue) {
      disagreeingAxes.push(axis);
    }
  }
  if (disagreeingAxes.length === 0) return null;

  return {
    axes: disagreeingAxes,
    classifierConfidence: classifierUnconstrained.confidence,
    surfaced: false,
    surfacedAt: null,
    resolution: 'pending',
  };
};

const stripOverrideMetadata = (
  overrides: OverriddenAxes | null
): AxisOverrides | undefined => {
  if (!overrides) return undefined;
  // The vertical config only consumes the three axis values; the audit fields
  // (overriddenAt / overriddenBy) are persistence-only.
  const constraints: AxisOverrides = {};
  if (overrides.retentionModel)
    constraints.retentionModel = overrides.retentionModel;
  if (overrides.commitmentLevel)
    constraints.commitmentLevel = overrides.commitmentLevel;
  if (overrides.marketPosition)
    constraints.marketPosition = overrides.marketPosition;
  return constraints;
};

const classifyBusinessImpl = async (
  db: DbConnection,
  input: ClassifyBusinessInput
): Promise<Result<BusinessProfile>> => {
  const parsed = classifyBusinessSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId, force, ownerSelfReport, reason } = parsed.data;
  const runReason: ClassifierRunReason =
    reason ?? (force ? 'force' : 'unknown');
  const runStart = Date.now();

  const org = await db.query.organization.findFirst({
    where: and(eq(organization.id, organizationId), notDeleted(organization)),
  });
  if (!org) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  const services = await db.query.organizationService.findMany({
    where: eq(organizationService.organizationId, organizationId),
  });

  const existing = await db.query.businessProfile.findFirst({
    where: eq(businessProfile.organizationId, organizationId),
  });

  const vertical: BusinessVertical =
    existing?.vertical ?? ownerSelfReport?.vertical ?? 'aesthetic_clinic';
  const config = getVerticalConfig(vertical);

  const inputHash = computeInputHash({
    services,
    chatbotSettings: org.chatbotSettings ?? null,
    ownerSelfReport,
  });

  const isUpToDate =
    !!existing &&
    existing.inputHash === inputHash &&
    existing.classifierVersion === config.version &&
    !force;
  if (isUpToDate) {
    return ok(existing);
  }

  try {
    const classifyResult = await config.classify({
      organizationName: org.name,
      services,
      chatbotSettings: org.chatbotSettings ?? null,
      ownerSelfReport,
      constraints: stripOverrideMetadata(existing?.overriddenAxes ?? null),
    });

    // LLM-first ranking. The model reads the real menu and picks the services
    // to advertise (with strategy + intro price) per the spec rules. When it's
    // unavailable (no API key) or returns nothing usable, fall back to the
    // deterministic keyword ranker. `rankingSource` is recorded in
    // verticalMetadata so the live read path (recomputeRanking) knows whether
    // the cached order is an LLM decision to honour or a keyword result to
    // recompute live.
    let rankedServices: Awaited<ReturnType<typeof composeRecommendation>>;
    let rankingSource: 'llm' | 'keyword' = 'keyword';
    const selection = config.selectServices
      ? await config.selectServices({
          organizationName: org.name,
          services,
          axes: classifyResult.effective,
          chatbotSettings: org.chatbotSettings ?? null,
          verticalMetadata: classifyResult.verticalMetadata,
        })
      : null;

    if (selection && selection.length > 0) {
      rankedServices = await composeFromSelection({
        config,
        organizationName: org.name,
        axes: classifyResult.effective,
        services,
        selection,
        chatbotSettings: org.chatbotSettings ?? null,
      });
      rankingSource = 'llm';
    } else {
      const rankedBase = config.rankServices({
        axes: classifyResult.effective,
        services,
        verticalMetadata: classifyResult.verticalMetadata,
      });
      rankedServices = await composeRecommendation({
        config,
        organizationName: org.name,
        axes: classifyResult.effective,
        rankedBase,
        services,
        chatbotSettings: org.chatbotSettings ?? null,
      });
    }

    const verticalMetadataWithSource = {
      ...classifyResult.verticalMetadata,
      rankingSource,
    };

    const classifierAxes: ClassifierAxes = {
      retentionModel: classifyResult.classifierUnconstrained.retentionModel,
      commitmentLevel: classifyResult.classifierUnconstrained.commitmentLevel,
      marketPosition: classifyResult.classifierUnconstrained.marketPosition,
      confidence: classifyResult.classifierUnconstrained.confidence,
      reasoning: classifyResult.reasoning,
    };

    const disagreement = computeDisagreement(
      classifierAxes,
      existing?.overriddenAxes ?? null
    );

    const baseRow = {
      organizationId,
      vertical,
      retentionModel: classifyResult.effective.retentionModel,
      commitmentLevel: classifyResult.effective.commitmentLevel,
      marketPosition: classifyResult.effective.marketPosition,
      axesConfidence: classifyResult.confidence,
      axesReasoning: classifyResult.reasoning,
      classifierAxes,
      overriddenAxes: existing?.overriddenAxes ?? null,
      disagreement,
      rankedServices,
      inputHash,
      classifiedAt: new Date(),
      classifierVersion: config.version,
      verticalMetadata: verticalMetadataWithSource,
    };

    const durationMs = Date.now() - runStart;
    trackClassifierRun({
      organizationId,
      vertical,
      classifierVersion: config.version,
      reason: runReason,
      durationMs,
      tookLlmFallback: false,
    });
    // Emit the "new disagreement" event only when this run actually
    // produced one. Existing rows where the previous disagreement persists
    // unchanged don't re-fire; the rows-of-interest for product analysis are
    // the freshly minted disagreements.
    const previousDisagreementAxes =
      existing?.disagreement?.axes?.slice().sort().join(',') ?? '';
    const nextDisagreementAxes =
      disagreement?.axes?.slice().sort().join(',') ?? '';
    if (disagreement && previousDisagreementAxes !== nextDisagreementAxes) {
      trackClassifierDisagreementDetected({
        organizationId,
        vertical,
        classifierVersion: config.version,
        axes: disagreement.axes,
        classifierConfidence: disagreement.classifierConfidence,
      });
    }

    if (existing) {
      const [updated] = await db
        .update(businessProfile)
        .set(baseRow)
        .where(eq(businessProfile.id, existing.id))
        .returning();
      if (!updated) {
        return err(
          new FeatureError(
            ErrorCodes.INTERNAL_ERROR,
            'Failed to persist business profile'
          )
        );
      }
      return ok(updated);
    }

    // Insert rather than upsert: `existing` was read outside a transaction, so
    // a concurrent run for the same org can win the race between that read and
    // this write. business_profile is 1:1 with organization, so the loser must
    // fold into an update rather than raise 23505.
    //
    // It cannot simply write `baseRow`, though. Every override-derived field in
    // it was computed while we believed there were no overrides: the classifier
    // ran unconstrained (`constraints: undefined`), so `effective` is the raw
    // guess, and `computeDisagreement(_, null)` returned null. If the winner
    // persisted real owner overrides, writing those fields would leave a row
    // that carries the overrides but whose effective axes ignore them, with the
    // disagreement that should flag exactly that wiped to null.
    const [inserted] = await db
      .insert(businessProfile)
      .values(baseRow)
      .onConflictDoNothing({ target: businessProfile.organizationId })
      .returning();
    if (inserted) return ok(inserted);

    // Lost the race. Re-read what the winner wrote and decide against it.
    const raced = await db.query.businessProfile.findFirst({
      where: eq(businessProfile.organizationId, organizationId),
    });
    if (!raced) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to persist business profile'
        )
      );
    }

    // No overrides on the winning row: our unconstrained run was the right
    // computation after all, so every field of baseRow is valid.
    if (!raced.overriddenAxes) {
      const [updated] = await db
        .update(businessProfile)
        .set(baseRow)
        .where(eq(businessProfile.id, raced.id))
        .returning();
      if (!updated) {
        return err(
          new FeatureError(
            ErrorCodes.INTERNAL_ERROR,
            'Failed to persist business profile'
          )
        );
      }
      return ok(updated);
    }

    // The winner holds overrides we classified without. Write only what does
    // not depend on them — `classifierAxes` is the unconstrained output by
    // definition, and the disagreement can be recomputed here for free because
    // computeDisagreement is pure. The effective axes and `overriddenAxes` stay
    // as the winner left them.
    //
    // `inputHash` is deliberately NOT written. Leaving it stale is what makes
    // this self-healing: the next classifyBusiness run fails `isUpToDate`, sees
    // the overrides, and recomputes the effective axes under the real
    // constraints. Writing it here would mark the row current and strand it.
    const [reconciled] = await db
      .update(businessProfile)
      .set({
        classifierAxes,
        disagreement: computeDisagreement(classifierAxes, raced.overriddenAxes),
        rankedServices,
        classifiedAt: baseRow.classifiedAt,
        classifierVersion: config.version,
        verticalMetadata: verticalMetadataWithSource,
      })
      .where(eq(businessProfile.id, raced.id))
      .returning();
    if (!reconciled) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to persist business profile'
        )
      );
    }
    return ok(reconciled);
  } catch (error) {
    logError('claire.classifyBusiness', error, {
      feature: 'claire',
      extra: { organizationId, vertical },
    });
    trackClassifierFailed({
      organizationId,
      vertical,
      classifierVersion: getVerticalConfig(vertical).version,
      reason: runReason,
      durationMs: Date.now() - runStart,
      tookLlmFallback: false,
      errorCode: ErrorCodes.INTERNAL_ERROR,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to classify business')
    );
  }
};

export const classifyBusiness = (
  db: DbConnection,
  input: ClassifyBusinessInput
) =>
  trackedResult(
    'claire.classifyBusiness',
    () => classifyBusinessImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type ClassifyBusinessResult = Awaited<
  ReturnType<typeof classifyBusiness>
>;

export { computeDisagreement };
