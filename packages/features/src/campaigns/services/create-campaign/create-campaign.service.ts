import { campaign, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CreateCampaignInput,
  createCampaignSchema,
} from './create-campaign.schema.js';

const createCampaignImpl = async (
  db: DbConnection,
  input: CreateCampaignInput
) => {
  const parsed = createCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, name, type, channels, segmentId, scheduledAt } =
    parsed.data;

  const [row] = await db
    .insert(campaign)
    .values({
      organizationId,
      name,
      type,
      channels,
      segmentId: segmentId ?? null,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      status: scheduledAt ? 'scheduled' : 'draft',
      createdById: parsed.data.createdById ?? null,
    })
    .returning();

  return ok(row);
};

export const createCampaign = (db: DbConnection, input: CreateCampaignInput) =>
  trackedResult(
    'campaigns.createCampaign',
    () => withOrgScope((tx) => createCampaignImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type CreateCampaignResult = Awaited<ReturnType<typeof createCampaign>>;
