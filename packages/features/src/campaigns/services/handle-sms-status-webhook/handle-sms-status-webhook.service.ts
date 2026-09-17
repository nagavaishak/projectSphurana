import {
  campaign,
  campaignEvent,
  campaignRecipient,
  suppression,
  withSystemScope,
} from '@borradh-workspace/database';
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
import { normalizeContact } from '../_shared/index.js';
import {
  type HandleSmsStatusWebhookInput,
  handleSmsStatusWebhookSchema,
} from './handle-sms-status-webhook.schema.js';

export interface HandleSmsStatusWebhookData {
  action: string;
}

/**
 * Twilio error code 21610: the destination has replied STOP, so the carrier
 * refused the message. Twilio blocks these at the account level going forward,
 * but our own suppression list has to learn about it too — otherwise every
 * future campaign keeps burning a send (and a credit) on a number that can
 * never receive one.
 */
const STOP_FILTERED_ERROR_CODE = '21610';

/**
 * Process a Twilio message-status callback. Maps the callback to a campaign
 * recipient via the message SID, then:
 *   - delivered              -> recipient `delivered` + delivered event
 *   - undelivered | failed   -> recipient `failed`
 *   - undelivered w/ 21610   -> also suppress the number (recipient replied STOP)
 *
 * Interim states (queued/sending/sent) are ignored: the send path already wrote
 * `sent`, and moving backwards from `delivered` on a late-arriving callback
 * would corrupt the funnel.
 *
 * System scope: the webhook has no auth/org context; the org is derived from
 * the matched recipient's campaign.
 */
const handleSmsStatusWebhookImpl = async (
  db: DbConnection,
  input: HandleSmsStatusWebhookInput
): Promise<Result<HandleSmsStatusWebhookData>> => {
  const parsed = handleSmsStatusWebhookSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { messageSid, messageStatus, errorCode, to } = parsed.data;
  if (!messageSid) return ok({ action: 'no_message_sid' });

  const status = messageStatus.toLowerCase();
  if (
    status !== 'delivered' &&
    status !== 'undelivered' &&
    status !== 'failed'
  ) {
    return ok({ action: 'ignored' });
  }

  const recipient = await db.query.campaignRecipient.findFirst({
    where: eq(campaignRecipient.providerMessageId, messageSid),
  });
  if (!recipient) return ok({ action: 'unknown_recipient' });

  if (status === 'delivered') {
    await db
      .update(campaignRecipient)
      .set({ status: 'delivered', deliveredAt: new Date() })
      .where(eq(campaignRecipient.id, recipient.id));
    await db.insert(campaignEvent).values({
      campaignId: recipient.campaignId,
      recipientId: recipient.id,
      type: 'delivered',
    });
    return ok({ action: 'delivered' });
  }

  await db
    .update(campaignRecipient)
    .set({ status: 'failed' })
    .where(eq(campaignRecipient.id, recipient.id));

  if (errorCode === STOP_FILTERED_ERROR_CODE && to) {
    const camp = await db.query.campaign.findFirst({
      where: eq(campaign.id, recipient.campaignId),
      columns: { organizationId: true },
    });
    if (camp?.organizationId) {
      await db
        .insert(suppression)
        .values({
          organizationId: camp.organizationId,
          channel: 'sms',
          contact: normalizeContact('sms', to),
          reason: 'stop',
          source: 'twilio',
        })
        .onConflictDoNothing();
      return ok({ action: 'failed_stop_filtered' });
    }
  }

  return ok({ action: `failed${errorCode ? `_${errorCode}` : ''}` });
};

export const handleSmsStatusWebhook = (
  db: DbConnection,
  input: HandleSmsStatusWebhookInput
) =>
  trackedResult(
    'campaigns.handleSmsStatusWebhook',
    () =>
      withSystemScope((conn) => handleSmsStatusWebhookImpl(conn, input), {
        db,
      }),
    { properties: { messageStatus: input.messageStatus } }
  );

export type HandleSmsStatusWebhookResult = Awaited<
  ReturnType<typeof handleSmsStatusWebhook>
>;
