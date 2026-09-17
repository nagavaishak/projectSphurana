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
} from '../../../shared/index.js';
import {
  type SetMarketPositionInput,
  setMarketPositionSchema,
} from './set-market-position.schema.js';

// Single-purpose endpoint used by the onboarding step (Window 4) and the
// inline backfill prefix in the /ads/new widget (Window 5). Persists
// marketPosition only — no reclassification, no LLM call.
//
// If the business_profile row doesn't exist yet (typical for orgs answering
// during onboarding, before the post-onboarding classifier has run), this
// stubs a minimal row with placeholder inputHash + classifierVersion so the
// classifier later detects it and overwrites everything else.
const setMarketPositionImpl = async (
  db: DbConnection,
  input: SetMarketPositionInput
): Promise<Result<BusinessProfile>> => {
  const parsed = setMarketPositionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId, marketPosition } = parsed.data;

  const existing = await db.query.businessProfile.findFirst({
    where: eq(businessProfile.organizationId, organizationId),
  });

  if (existing) {
    const [updated] = await db
      .update(businessProfile)
      .set({ marketPosition })
      .where(eq(businessProfile.id, existing.id))
      .returning();
    if (!updated) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to update market position'
        )
      );
    }
    return ok(updated);
  }

  // Stub a row. The 'pending' placeholders are recognised by classifyBusiness
  // as needs-classification regardless of inputHash. Defaults for the other
  // axes will be overwritten by the classifier; we pick the most-conservative
  // values so any consumer reading the row before classification gets
  // something sane.
  const [inserted] = await db
    .insert(businessProfile)
    .values({
      organizationId,
      vertical: 'aesthetic_clinic',
      retentionModel: 'rebooking',
      commitmentLevel: 'planned',
      marketPosition,
      inputHash: 'pending',
      classifierVersion: 'pending',
    })
    .returning();
  if (!inserted) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create business profile stub'
      )
    );
  }
  return ok(inserted);
};

export const setMarketPosition = (
  db: DbConnection,
  input: SetMarketPositionInput
) =>
  trackedResult(
    'claire.setMarketPosition',
    () => setMarketPositionImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        marketPosition: input.marketPosition,
      },
    }
  );

export type SetMarketPositionResult = Awaited<
  ReturnType<typeof setMarketPosition>
>;
