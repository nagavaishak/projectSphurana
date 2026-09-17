import { campaign, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { CampaignErrorCodes } from '../../models/index.js';
import {
  type DeleteCampaignInput,
  deleteCampaignSchema,
} from './delete-campaign.schema.js';

const deleteCampaignImpl = async (
  db: DbConnection,
  input: DeleteCampaignInput
) => {
  const parsed = deleteCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const existing = await db.query.campaign.findFirst({
    where: and(eq(campaign.id, parsed.data.id), notDeleted(campaign)),
  });
  if (!existing) {
    return err(
      new FeatureError(
        CampaignErrorCodes.CAMPAIGN_NOT_FOUND,
        'Campaign not found'
      )
    );
  }
  // A campaign that's already sending/sent stays for its history + analytics.
  if (existing.status === 'sending' || existing.status === 'sent') {
    return err(
      new FeatureError(
        CampaignErrorCodes.CAMPAIGN_NOT_EDITABLE,
        'A sending or sent campaign cannot be deleted'
      )
    );
  }

  await db
    .update(campaign)
    .set({ deletedAt: new Date(), status: 'cancelled' })
    .where(eq(campaign.id, parsed.data.id));

  return ok({ success: true, id: parsed.data.id });
};

export const deleteCampaign = (db: DbConnection, input: DeleteCampaignInput) =>
  trackedResult(
    'campaigns.deleteCampaign',
    () => withOrgScope((tx) => deleteCampaignImpl(tx, input), { db }),
    { properties: { id: input.id, organizationId: input.organizationId } }
  );

export type DeleteCampaignResult = Awaited<ReturnType<typeof deleteCampaign>>;
