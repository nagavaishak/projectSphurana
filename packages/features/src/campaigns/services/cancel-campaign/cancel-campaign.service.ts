import {
  campaign,
  campaignRecipient,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
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
import { CampaignErrorCodes } from '../../models/index.js';
import {
  type CancelCampaignInput,
  cancelCampaignSchema,
} from './cancel-campaign.schema.js';

export interface CancelCampaignData {
  campaignId: string;
  cancelled: true;
}

/**
 * Cancel a draft/scheduled/sending/paused campaign. Queued recipients are
 * marked `skipped` so any in-flight worker jobs no-op them. A fully `sent`
 * campaign cannot be cancelled (it stays for history + analytics).
 */
const cancelCampaignImpl = async (
  db: DbConnection,
  input: CancelCampaignInput
): Promise<Result<CancelCampaignData>> => {
  const parsed = cancelCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id } = parsed.data;

  const camp = await db.query.campaign.findFirst({
    where: and(eq(campaign.id, id), notDeleted(campaign)),
  });
  if (!camp) {
    return err(
      new FeatureError(
        CampaignErrorCodes.CAMPAIGN_NOT_FOUND,
        'Campaign not found'
      )
    );
  }
  if (camp.status === 'sent') {
    return err(
      new FeatureError(
        CampaignErrorCodes.CAMPAIGN_NOT_EDITABLE,
        'A sent campaign cannot be cancelled'
      )
    );
  }

  await db
    .update(campaign)
    .set({ status: 'cancelled' })
    .where(eq(campaign.id, id));

  // Stop any not-yet-sent recipients so in-flight jobs no-op (status != queued).
  await db
    .update(campaignRecipient)
    .set({ status: 'skipped' })
    .where(
      and(
        eq(campaignRecipient.campaignId, id),
        eq(campaignRecipient.status, 'queued')
      )
    );

  return ok({ campaignId: id, cancelled: true });
};

export const cancelCampaign = (db: DbConnection, input: CancelCampaignInput) =>
  trackedResult(
    'campaigns.cancelCampaign',
    () => withOrgScope((tx) => cancelCampaignImpl(tx, input), { db }),
    { properties: { id: input.id, organizationId: input.organizationId } }
  );

export type CancelCampaignResult = Awaited<ReturnType<typeof cancelCampaign>>;
