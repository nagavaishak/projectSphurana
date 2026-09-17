import {
  campaign,
  campaignRecipient,
  withOrgScope,
} from '@borradh-workspace/database';
import { campaignChannelLabels } from '@borradh-workspace/labels';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { CampaignErrorCodes } from '../../models/index.js';
import { checkChannelEntitlement } from '../check-channel-entitlement/index.js';
import { getCampaign } from '../get-campaign/index.js';
import { materializeRecipients } from '../materialize-recipients/index.js';
import { syncWhatsappTemplates } from '../sync-whatsapp-templates/index.js';
import {
  type LaunchCampaignInput,
  launchCampaignSchema,
} from './launch-campaign.schema.js';
import {
  collectLaunchBlockers,
  formatLaunchBlockers,
} from './launch-preflight.js';

/** Injected by the API/worker — enqueues one send job per recipient. */
export type EnqueueCampaignJob = (args: {
  recipientId: string;
  organizationId: string;
  campaignId: string;
}) => Promise<void>;

export interface LaunchCampaignData {
  campaignId: string;
  materialized: number;
  enqueued: number;
}

const launchCampaignImpl = async (
  db: DbConnection,
  input: LaunchCampaignInput,
  enqueue: EnqueueCampaignJob
): Promise<Result<LaunchCampaignData>> => {
  const { organizationId, id } = input;

  const campRes = await getCampaign(db, { organizationId, id });
  if (!campRes.success) {
    return err(
      new FeatureError(
        campRes.error.code,
        campRes.error.message,
        campRes.error.details
      )
    );
  }
  const camp = campRes.data;

  if (camp.status !== 'draft' && camp.status !== 'scheduled') {
    return err(
      new FeatureError(
        CampaignErrorCodes.CAMPAIGN_NOT_EDITABLE,
        'Campaign has already been launched'
      )
    );
  }
  if (!camp.segmentId) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Campaign has no audience segment'
      )
    );
  }
  if (!camp.messages || camp.messages.length === 0) {
    return err(
      new FeatureError(
        CampaignErrorCodes.CHANNEL_NOT_CONFIGURED,
        'Campaign has no message content'
      )
    );
  }

  const channels = camp.channels as ('email' | 'sms' | 'whatsapp')[];

  // Gate per-channel entitlement — SMS/WhatsApp require a paid plan.
  const entitlement = await checkChannelEntitlement(db, {
    organizationId,
    channels,
  });
  if (!entitlement.success) {
    return err(
      new FeatureError(
        entitlement.error.code,
        entitlement.error.message,
        entitlement.error.details
      )
    );
  }
  if (entitlement.data.blocked.length > 0) {
    const blockedChannels = entitlement.data.blocked
      .map((b) => campaignChannelLabels[b.channel] ?? b.channel)
      .join(', ');
    return err(
      new FeatureError(
        ErrorCodes.FORBIDDEN,
        `Your plan doesn't include ${blockedChannels}. Upgrade to send by SMS or WhatsApp.`,
        { blocked: entitlement.data.blocked }
      )
    );
  }

  // Template sends: refresh the WhatsApp template cache from Meta right
  // before preflight, so the approval check below runs against Meta's current
  // state (templates get paused/rejected between authoring and sending).
  // Best-effort — if Meta is unreachable the cached status stays
  // authoritative and preflight still gates on it.
  const usesWhatsappTemplate =
    channels.includes('whatsapp') &&
    camp.messages.some((m) => m.channel === 'whatsapp' && m.whatsappTemplateId);
  if (usesWhatsappTemplate) {
    await syncWhatsappTemplates(db, { organizationId, refresh: true });
  }

  // Per-channel readiness — refuse to launch (with actionable reasons) rather
  // than materialize recipients that would silently fail at send time because a
  // channel has no content or the org can't deliver on it (no SMS number /
  // credits / WhatsApp account).
  const blockers = await withOrgScope(
    (tx) =>
      collectLaunchBlockers(tx, {
        organizationId,
        channels,
        messages: camp.messages,
      }),
    { db }
  );
  if (blockers.length > 0) {
    return err(
      new FeatureError(
        CampaignErrorCodes.CHANNEL_NOT_CONFIGURED,
        `Can't launch yet: ${formatLaunchBlockers(blockers)}`,
        { blockers }
      )
    );
  }

  // Materialize the send list (idempotent — safe on re-launch).
  const mat = await materializeRecipients(db, {
    organizationId,
    campaignId: camp.id,
    channels,
    segmentId: camp.segmentId,
  });
  if (!mat.success) {
    return err(
      new FeatureError(mat.error.code, mat.error.message, mat.error.details)
    );
  }

  // Flip to sending and enqueue every queued recipient.
  return withOrgScope(
    async (tx) => {
      await tx
        .update(campaign)
        .set({ status: 'sending', sentAt: new Date() })
        .where(eq(campaign.id, camp.id));

      const recipients = await tx.query.campaignRecipient.findMany({
        where: and(
          eq(campaignRecipient.campaignId, camp.id),
          eq(campaignRecipient.status, 'queued')
        ),
        columns: { id: true },
      });

      for (const r of recipients) {
        await enqueue({
          recipientId: r.id,
          organizationId,
          campaignId: camp.id,
        });
      }

      return ok({
        campaignId: camp.id,
        materialized: mat.data.materialized,
        enqueued: recipients.length,
      });
    },
    { db }
  );
};

export const launchCampaign = (
  db: DbConnection,
  input: LaunchCampaignInput,
  enqueue: EnqueueCampaignJob
) =>
  trackedResult(
    'campaigns.launchCampaign',
    () => {
      const parsed = launchCampaignSchema.safeParse(input);
      if (!parsed.success) {
        return Promise.resolve(
          err(
            new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
              issues: parsed.error.issues,
            })
          )
        );
      }
      return launchCampaignImpl(db, parsed.data, enqueue);
    },
    { properties: { id: input.id, organizationId: input.organizationId } }
  );

export type LaunchCampaignResult = Awaited<ReturnType<typeof launchCampaign>>;
