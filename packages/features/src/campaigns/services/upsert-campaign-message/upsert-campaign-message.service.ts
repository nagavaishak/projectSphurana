import { campaignMessage, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type UpsertCampaignMessageInput,
  upsertCampaignMessageSchema,
} from './upsert-campaign-message.schema.js';

/**
 * Create or replace the per-channel content for a campaign. Keyed on the
 * `(campaign_id, channel)` unique constraint so a channel always has exactly
 * one message.
 */
const upsertCampaignMessageImpl = async (
  db: DbConnection,
  input: UpsertCampaignMessageInput
) => {
  const parsed = upsertCampaignMessageSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    campaignId,
    channel,
    subject,
    body,
    whatsappTemplateId,
    whatsappTemplateParams,
    mediaUrl,
  } = parsed.data;

  const [row] = await db
    .insert(campaignMessage)
    .values({
      campaignId,
      channel,
      subject: subject ?? null,
      body,
      whatsappTemplateId: whatsappTemplateId ?? null,
      whatsappTemplateParams: whatsappTemplateParams ?? null,
      mediaUrl: mediaUrl ?? null,
    })
    .onConflictDoUpdate({
      target: [campaignMessage.campaignId, campaignMessage.channel],
      set: {
        subject: subject ?? null,
        body,
        whatsappTemplateId: whatsappTemplateId ?? null,
        whatsappTemplateParams: whatsappTemplateParams ?? null,
        mediaUrl: mediaUrl ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return ok(row);
};

export const upsertCampaignMessage = (
  db: DbConnection,
  input: UpsertCampaignMessageInput
) =>
  trackedResult(
    'campaigns.upsertCampaignMessage',
    () => withOrgScope((tx) => upsertCampaignMessageImpl(tx, input), { db }),
    {
      properties: {
        campaignId: input.campaignId,
        organizationId: input.organizationId,
      },
    }
  );

export type UpsertCampaignMessageResult = Awaited<
  ReturnType<typeof upsertCampaignMessage>
>;
