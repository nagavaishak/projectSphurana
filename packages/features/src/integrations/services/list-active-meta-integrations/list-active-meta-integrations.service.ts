import { metaAdsIntegration } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { logError } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';

interface ActiveMetaIntegration {
  organizationId: string;
}

const listActiveMetaIntegrationsImpl = async (
  db: DbConnection
): Promise<Result<ActiveMetaIntegration[]>> => {
  try {
    const integrations = await db.query.metaAdsIntegration.findMany({
      where: and(
        eq(metaAdsIntegration.isActive, true),
        eq(metaAdsIntegration.configurationStatus, 'configured'),
        // Skip integrations whose token is known-dead: background sync loops
        // hammering a revoked token are pure retry noise until the user
        // reconnects (which resets tokenStatus to 'valid'). Webhook-driven,
        // user-value paths (e.g. lead capture) do NOT consult this list and
        // always attempt their capability.
        eq(metaAdsIntegration.tokenStatus, 'valid')
      ),
      columns: { organizationId: true },
    });

    return ok(integrations);
  } catch (error) {
    logError('integrations.listActiveMetaIntegrations', error, {
      feature: 'integrations',
    });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to list active Meta integrations'
      )
    );
  }
};

export const listActiveMetaIntegrations = (db: DbConnection) =>
  trackedResult(
    'integrations.listActiveMetaIntegrations',
    () => listActiveMetaIntegrationsImpl(db),
    { trackSuccess: false, trackFailure: false }
  );

export type ListActiveMetaIntegrationsResult = Awaited<
  ReturnType<typeof listActiveMetaIntegrations>
>;
