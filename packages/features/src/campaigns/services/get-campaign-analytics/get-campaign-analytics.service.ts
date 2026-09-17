import { campaignRecipient, withOrgScope } from '@borradh-workspace/database';
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
  type GetCampaignAnalyticsInput,
  getCampaignAnalyticsSchema,
} from './get-campaign-analytics.schema.js';

export interface CampaignAnalytics {
  total: number;
  sent: number;
  delivered: number;
  failed: number;
  optedOut: number;
  opened: number;
  clicked: number;
}

/**
 * Funnel analytics for a campaign, derived from the materialized recipient rows
 * (status + delivery/open/click timestamps set by the send pipeline and the
 * Resend webhook). Org-scoped read.
 */
const getCampaignAnalyticsImpl = async (
  db: DbConnection,
  input: GetCampaignAnalyticsInput
): Promise<Result<CampaignAnalytics>> => {
  const parsed = getCampaignAnalyticsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const recipients = await db.query.campaignRecipient.findMany({
    where: eq(campaignRecipient.campaignId, parsed.data.id),
    columns: {
      status: true,
      deliveredAt: true,
      openedAt: true,
      clickedAt: true,
    },
  });

  const stats: CampaignAnalytics = {
    total: recipients.length,
    sent: 0,
    delivered: 0,
    failed: 0,
    optedOut: 0,
    opened: 0,
    clicked: 0,
  };

  for (const r of recipients) {
    if (r.status === 'sent' || r.status === 'delivered') stats.sent++;
    if (r.status === 'delivered' || r.deliveredAt) stats.delivered++;
    if (r.status === 'failed' || r.status === 'bounced') stats.failed++;
    if (r.status === 'opted_out') stats.optedOut++;
    if (r.openedAt) stats.opened++;
    if (r.clickedAt) stats.clicked++;
  }

  return ok(stats);
};

export const getCampaignAnalytics = (
  db: DbConnection,
  input: GetCampaignAnalyticsInput
) =>
  trackedResult(
    'campaigns.getCampaignAnalytics',
    () => withOrgScope((tx) => getCampaignAnalyticsImpl(tx, input), { db }),
    { properties: { id: input.id, organizationId: input.organizationId } }
  );

export type GetCampaignAnalyticsResult = Awaited<
  ReturnType<typeof getCampaignAnalytics>
>;
