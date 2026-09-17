import { metaAdsIntegration } from '@borradh-workspace/database';
import {
  logError,
  trackOrgEvent,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';

export interface MetaTokenHealthSnapshot {
  total: number;
  healthy: number;
  needsReconnect: number;
  expired: number;
}

/**
 * Daily population snapshot of Meta token health. Reads the stored
 * `tokenStatus` / `tokenExpiresAt` columns (no Meta API calls) and emits one
 * `meta_token_health` PostHog event per connected org so we can trend the
 * percentage of orgs with a healthy connection over time — a population metric,
 * not an error spike (those belong in BetterStack/Sentry).
 */
const snapshotMetaTokenHealthImpl = async (
  db: DbConnection
): Promise<Result<MetaTokenHealthSnapshot>> => {
  try {
    const integrations = await db.query.metaAdsIntegration.findMany({
      where: and(
        eq(metaAdsIntegration.isActive, true),
        eq(metaAdsIntegration.configurationStatus, 'configured')
      ),
      columns: {
        organizationId: true,
        tokenStatus: true,
        tokenExpiresAt: true,
      },
    });

    const now = Date.now();
    let healthy = 0;
    let needsReconnect = 0;
    let expired = 0;

    for (const integration of integrations) {
      const isExpired =
        integration.tokenExpiresAt != null &&
        integration.tokenExpiresAt.getTime() <= now;
      const isHealthy = integration.tokenStatus === 'valid' && !isExpired;

      if (isExpired) expired++;
      if (integration.tokenStatus !== 'valid') needsReconnect++;
      if (isHealthy) healthy++;

      trackOrgEvent(integration.organizationId, 'meta_token_health', {
        organizationId: integration.organizationId,
        tokenStatus: integration.tokenStatus,
        expired: isExpired,
        healthy: isHealthy,
      });
    }

    return ok({
      total: integrations.length,
      healthy,
      needsReconnect,
      expired,
    });
  } catch (error) {
    logError('integrations.snapshotMetaTokenHealth', error, {
      feature: 'integrations',
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to snapshot Meta token health'
      )
    );
  }
};

export const snapshotMetaTokenHealth = (db: DbConnection) =>
  trackedResult(
    'integrations.snapshotMetaTokenHealth',
    () => snapshotMetaTokenHealthImpl(db),
    { trackSuccess: false, trackFailure: false }
  );

export type SnapshotMetaTokenHealthResult = Awaited<
  ReturnType<typeof snapshotMetaTokenHealth>
>;
