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
  type GetCampaignInput,
  getCampaignSchema,
} from './get-campaign.schema.js';

const getCampaignImpl = async (db: DbConnection, input: GetCampaignInput) => {
  const parsed = getCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const row = await db.query.campaign.findFirst({
    // Explicit org scoping (defence-in-depth alongside RLS): without it a
    // caller could read another org's campaign by id when RLS is off.
    where: and(
      eq(campaign.id, parsed.data.id),
      eq(campaign.organizationId, parsed.data.organizationId),
      notDeleted(campaign)
    ),
    with: { messages: true },
  });

  if (!row) {
    return err(
      new FeatureError(
        CampaignErrorCodes.CAMPAIGN_NOT_FOUND,
        'Campaign not found'
      )
    );
  }

  return ok(row);
};

export const getCampaign = (db: DbConnection, input: GetCampaignInput) =>
  trackedResult(
    'campaigns.getCampaign',
    () => withOrgScope((tx) => getCampaignImpl(tx, input), { db }),
    { properties: { id: input.id }, internalErrorsOnly: true }
  );

export type GetCampaignResult = Awaited<ReturnType<typeof getCampaign>>;
