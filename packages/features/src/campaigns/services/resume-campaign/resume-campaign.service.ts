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
import type { EnqueueCampaignJob } from '../launch-campaign/index.js';
import {
  type ResumeCampaignInput,
  resumeCampaignSchema,
} from './resume-campaign.schema.js';

export interface ResumeCampaignData {
  campaignId: string;
  enqueued: number;
}

/**
 * Resume a paused campaign (paused on mid-blast credit exhaustion, or manually).
 * Re-enqueues only the still-`queued` recipients — the idempotency claim in the
 * send primitive guarantees no `sent` recipient is re-sent or re-charged.
 */
const resumeCampaignImpl = async (
  db: DbConnection,
  input: ResumeCampaignInput,
  enqueue: EnqueueCampaignJob
): Promise<Result<ResumeCampaignData>> => {
  const parsed = resumeCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, id } = parsed.data;

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
  if (camp.status !== 'paused') {
    return err(
      new FeatureError(
        CampaignErrorCodes.CAMPAIGN_NOT_EDITABLE,
        'Only a paused campaign can be resumed'
      )
    );
  }

  await db
    .update(campaign)
    .set({ status: 'sending' })
    .where(eq(campaign.id, id));

  const recipients = await db.query.campaignRecipient.findMany({
    where: and(
      eq(campaignRecipient.campaignId, id),
      eq(campaignRecipient.status, 'queued')
    ),
    columns: { id: true },
  });

  for (const r of recipients) {
    await enqueue({ recipientId: r.id, organizationId, campaignId: id });
  }

  return ok({ campaignId: id, enqueued: recipients.length });
};

export const resumeCampaign = (
  db: DbConnection,
  input: ResumeCampaignInput,
  enqueue: EnqueueCampaignJob
) =>
  trackedResult(
    'campaigns.resumeCampaign',
    () => withOrgScope((tx) => resumeCampaignImpl(tx, input, enqueue), { db }),
    { properties: { id: input.id, organizationId: input.organizationId } }
  );

export type ResumeCampaignResult = Awaited<ReturnType<typeof resumeCampaign>>;
