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
  type UpdateCampaignInput,
  updateCampaignSchema,
} from './update-campaign.schema.js';

const updateCampaignImpl = async (
  db: DbConnection,
  input: UpdateCampaignInput
) => {
  const parsed = updateCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, name, channels, segmentId, scheduledAt } = parsed.data;

  const existing = await db.query.campaign.findFirst({
    where: and(eq(campaign.id, id), notDeleted(campaign)),
  });
  if (!existing) {
    return err(
      new FeatureError(
        CampaignErrorCodes.CAMPAIGN_NOT_FOUND,
        'Campaign not found'
      )
    );
  }
  // Content/audience is immutable once a campaign has left draft/scheduled.
  if (existing.status !== 'draft' && existing.status !== 'scheduled') {
    return err(
      new FeatureError(
        CampaignErrorCodes.CAMPAIGN_NOT_EDITABLE,
        'Only draft or scheduled campaigns can be edited'
      )
    );
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (channels !== undefined) updates.channels = channels;
  if (segmentId !== undefined) updates.segmentId = segmentId;
  if (scheduledAt !== undefined) {
    updates.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
    updates.status = scheduledAt ? 'scheduled' : 'draft';
  }

  if (Object.keys(updates).length === 0) return ok(existing);

  const [row] = await db
    .update(campaign)
    .set(updates)
    .where(eq(campaign.id, id))
    .returning();

  return ok(row);
};

export const updateCampaign = (db: DbConnection, input: UpdateCampaignInput) =>
  trackedResult(
    'campaigns.updateCampaign',
    () => withOrgScope((tx) => updateCampaignImpl(tx, input), { db }),
    { properties: { id: input.id, organizationId: input.organizationId } }
  );

export type UpdateCampaignResult = Awaited<ReturnType<typeof updateCampaign>>;
