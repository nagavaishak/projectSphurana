import {
  metaAd,
  metaAdsIntegration,
  socialPost,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { logError } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type DisconnectMetaIntegrationInput,
  disconnectMetaIntegrationSchema,
} from './disconnect-meta-integration.schema.js';

/**
 * Internal implementation of disconnect Meta integration
 */
const disconnectMetaIntegrationImpl = async (
  db: DbConnection,
  input: DisconnectMetaIntegrationInput
): Promise<Result<{ success: true }>> => {
  const parsed = disconnectMetaIntegrationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  try {
    // Verify integration exists before deleting
    const existing = await db.query.metaAdsIntegration.findFirst({
      where: (t, { eq }) => eq(t.organizationId, organizationId),
    });

    if (!existing) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Meta integration not found')
      );
    }

    // Instagram-only posts belong to the standalone Instagram integration
    // when one is active — disconnecting Meta Ads must not destroy them.
    const standaloneIg = await db.query.instagramIntegration.findFirst({
      where: (t, { and: andOp, eq: eqOp }) =>
        andOp(eqOp(t.organizationId, organizationId), eqOp(t.isActive, true)),
    });

    // Delete all Meta-related data in a transaction
    await db.transaction(async (tx) => {
      // 1. Delete all Meta ads for this organization
      await tx.delete(metaAd).where(eq(metaAd.organizationId, organizationId));

      // 2. Delete social posts belonging to this integration: everything
      // targeting Facebook, plus Instagram posts unless a standalone
      // Instagram integration still owns them.
      await tx
        .delete(socialPost)
        .where(
          and(
            eq(socialPost.organizationId, organizationId),
            standaloneIg
              ? sql`${socialPost.platforms} ? 'facebook'`
              : sql`${socialPost.platforms} ?| array['facebook', 'instagram']`
          )
        );

      // 3. Delete the integration (cascades to meta_ads_page)
      await tx
        .delete(metaAdsIntegration)
        .where(eq(metaAdsIntegration.organizationId, organizationId));
    });

    return ok({ success: true as const });
  } catch (error) {
    logError('integrations.disconnectMetaIntegration', error, {
      feature: 'integrations',
      extra: { organizationId },
    });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to disconnect Meta integration'
      )
    );
  }
};

/**
 * Disconnect Meta Ads integration from an organization
 */
export const disconnectMetaIntegration = (
  db: DbConnection,
  input: DisconnectMetaIntegrationInput
) =>
  trackedResult(
    'integrations.disconnectMetaIntegration',
    () =>
      withOrgScope((tx) => disconnectMetaIntegrationImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type DisconnectMetaIntegrationResult = Awaited<
  ReturnType<typeof disconnectMetaIntegration>
>;
