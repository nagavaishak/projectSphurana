import {
  campaignEvent,
  campaignMessage,
  campaignRecipient,
  lead,
  suppression,
  whatsappTemplate,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { useCredits } from '../../../billing/services/use-credits/use-credits.service.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { CampaignErrorCodes } from '../../models/index.js';
import {
  CAMPAIGN_PAID_CHANNELS,
  buildLeadMergeData,
  buildSuppressionIndex,
  buildUnsubscribeUrl,
  getTrackingSecret,
  planSend,
  signTrackingToken,
} from '../_shared/index.js';
import type { ChannelSenders } from './channel-senders.js';
import {
  type SendCampaignMessageInput,
  sendCampaignMessageSchema,
} from './send-campaign-message.schema.js';

/**
 * Send a single campaign recipient (one lead × channel). This is the IO wrapper
 * around the pure `planSend` decision:
 *
 *   1. load recipient + per-channel message + lead + org suppression
 *   2. plan (idempotency status-gate, eligibility, interpolation)
 *   3. atomically CLAIM the row (queued → sending) — exactly-once guarantee
 *   4. debit credits for paid channels (SMS); free channels skip the meter
 *   5. dispatch via the injected sender
 *   6. record sent/failed + append a `sent` event + stamp lead.lastContactedAt
 *
 * Channel senders are injected (the worker wires Resend/Twilio/WhatsApp), so
 * this stays decoupled and testable.
 */
export interface SendCampaignMessageData {
  sent: boolean;
  action: 'sent' | 'failed' | 'skip_not_queued' | 'skip_ineligible';
  providerMessageId?: string;
  error?: string;
}

const sendCampaignMessageImpl = async (
  db: DbConnection,
  input: SendCampaignMessageInput,
  senders: ChannelSenders
): Promise<Result<SendCampaignMessageData>> => {
  const parsed = sendCampaignMessageSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, recipientId } = parsed.data;

  const recipient = await db.query.campaignRecipient.findFirst({
    where: eq(campaignRecipient.id, recipientId),
  });
  if (!recipient) {
    return err(
      new FeatureError(
        CampaignErrorCodes.CAMPAIGN_NOT_FOUND,
        'Recipient not found'
      )
    );
  }

  const channel = recipient.channel as 'email' | 'sms' | 'whatsapp';

  const message = await db.query.campaignMessage.findFirst({
    where: and(
      eq(campaignMessage.campaignId, recipient.campaignId),
      eq(campaignMessage.channel, channel)
    ),
  });
  if (!message) {
    await db
      .update(campaignRecipient)
      .set({ status: 'failed', error: 'channel_not_configured' })
      .where(eq(campaignRecipient.id, recipient.id));
    return err(
      new FeatureError(
        CampaignErrorCodes.CHANNEL_NOT_CONFIGURED,
        `No ${channel} message configured for this campaign`
      )
    );
  }

  const leadRow = await db.query.lead.findFirst({
    where: eq(lead.id, recipient.leadId),
  });
  if (!leadRow) {
    return err(
      new FeatureError(CampaignErrorCodes.CAMPAIGN_NOT_FOUND, 'Lead not found')
    );
  }

  // WhatsApp template send: resolve the approved template so the dispatch is
  // business-initiated (works outside the 24h window). A configured-but-
  // unusable template is a per-recipient failure, not a crash — preflight
  // should have caught it, but templates can get paused/rejected mid-send.
  let templateArgs:
    | { name: string; languageCode: string; params: string[] }
    | undefined;
  if (channel === 'whatsapp' && message.whatsappTemplateId) {
    const template = await db.query.whatsappTemplate.findFirst({
      where: eq(whatsappTemplate.id, message.whatsappTemplateId),
    });
    if (!template || template.status !== 'approved') {
      await db
        .update(campaignRecipient)
        .set({ status: 'failed', error: 'whatsapp_template_not_approved' })
        .where(eq(campaignRecipient.id, recipient.id));
      return err(
        new FeatureError(
          CampaignErrorCodes.CHANNEL_NOT_CONFIGURED,
          'The WhatsApp template for this campaign is missing or not approved'
        )
      );
    }
    templateArgs = {
      name: template.name,
      languageCode: template.languageCode,
      params: message.whatsappTemplateParams ?? [],
    };
  }

  const suppressionRows = await db.query.suppression.findMany({
    where: eq(suppression.organizationId, organizationId),
    columns: { channel: true, contact: true },
  });
  const index = buildSuppressionIndex(suppressionRows);

  const plan = planSend({
    recipientStatus: recipient.status,
    channel,
    lead: leadRow,
    suppression: index,
    bodyTemplate: message.body,
    subjectTemplate: message.subject ?? undefined,
    mergeData: buildLeadMergeData(leadRow),
    whatsappTemplate: templateArgs,
  });

  if (plan.action === 'skip_not_queued') {
    return ok({ sent: false, action: plan.action } as const);
  }
  if (plan.action === 'skip_ineligible') {
    await db
      .update(campaignRecipient)
      .set({ status: 'skipped' })
      .where(
        and(
          eq(campaignRecipient.id, recipient.id),
          eq(campaignRecipient.status, 'queued')
        )
      );
    return ok({ sent: false, action: plan.action } as const);
  }

  // (3) Atomic claim — only one worker can flip queued → sending.
  const claimed = await db
    .update(campaignRecipient)
    .set({ status: 'sending' })
    .where(
      and(
        eq(campaignRecipient.id, recipient.id),
        eq(campaignRecipient.status, 'queued')
      )
    )
    .returning({ id: campaignRecipient.id });
  if (claimed.length === 0) {
    return ok({ sent: false, action: 'skip_not_queued' } as const);
  }

  // (4) Credits — only metered (paid) channels debit.
  if (CAMPAIGN_PAID_CHANNELS.includes(channel)) {
    const credit = await useCredits(db, {
      organizationId,
      channel,
      quantity: 1,
      referenceId: recipient.id,
      referenceType: 'campaign_recipient',
      description: `Campaign ${channel} send`,
    });
    if (!credit.success) {
      await db
        .update(campaignRecipient)
        .set({ status: 'failed', error: 'insufficient_credits' })
        .where(eq(campaignRecipient.id, recipient.id));
      return err(
        new FeatureError(
          CampaignErrorCodes.INSUFFICIENT_CREDITS,
          'Insufficient credits to send'
        )
      );
    }
  }

  // (5) Dispatch. Email carries a one-click unsubscribe (RFC 8058); SMS carries
  // an opt-out link in the body — mandatory for one-way alpha senders that
  // cannot receive a STOP reply.
  const unsubscribeUrl =
    channel === 'email' || channel === 'sms'
      ? buildUnsubscribeUrl(
          signTrackingToken(
            { r: recipient.id, c: channel },
            getTrackingSecret()
          )
        )
      : undefined;
  const outcome = await senders[channel]({
    to: plan.contact as string,
    body: plan.body as string,
    subject: plan.subject,
    unsubscribeUrl,
    whatsappTemplate: plan.whatsappTemplate,
  });

  if (!outcome.success) {
    if (outcome.retryable) {
      // Transient provider failure (e.g. Resend's rate limit) — release the
      // claim back to 'queued' instead of recording a permanent failure, so
      // the retried job re-claims and re-sends through the normal path
      // rather than skipping via the idempotency gate. Returning
      // INTERNAL_ERROR is what makes the worker throw and let BullMQ's
      // existing attempts/backoff retry the job.
      await db
        .update(campaignRecipient)
        .set({ status: 'queued', error: outcome.error })
        .where(eq(campaignRecipient.id, recipient.id));
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          outcome.error ?? 'Transient send failure'
        )
      );
    }
    await db
      .update(campaignRecipient)
      .set({ status: 'failed', error: outcome.error ?? 'send_failed' })
      .where(eq(campaignRecipient.id, recipient.id));
    return ok({
      sent: false,
      action: 'failed' as const,
      error: outcome.error,
    });
  }

  // (6) Record success.
  await db
    .update(campaignRecipient)
    .set({
      status: 'sent',
      providerMessageId: outcome.messageId,
      sentAt: new Date(),
    })
    .where(eq(campaignRecipient.id, recipient.id));
  await db.insert(campaignEvent).values({
    campaignId: recipient.campaignId,
    recipientId: recipient.id,
    type: 'sent',
  });
  await db
    .update(lead)
    .set({ lastContactedAt: new Date() })
    .where(eq(lead.id, recipient.leadId));

  return ok({
    sent: true,
    action: 'sent' as const,
    providerMessageId: outcome.messageId,
  });
};

export const sendCampaignMessage = (
  db: DbConnection,
  input: SendCampaignMessageInput,
  senders: ChannelSenders
) =>
  trackedResult(
    'campaigns.sendCampaignMessage',
    () =>
      withOrgScope((tx) => sendCampaignMessageImpl(tx, input, senders), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        recipientId: input.recipientId,
      },
    }
  );

export type SendCampaignMessageResult = Awaited<
  ReturnType<typeof sendCampaignMessage>
>;
