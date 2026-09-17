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
  type HandleResendWebhookInput,
  handleResendWebhookSchema,
} from './handle-resend-webhook.schema.js';

export interface HandleResendWebhookData {
  action: string;
}

/**
 * Process a Resend email event. Maps the event to a campaign recipient via the
 * provider message id, then:
 *   - bounced    -> recipient `bounced` + suppress the email (hard-bounce)
 *   - complained -> suppress the email (spam complaint)
 *   - delivered  -> recipient `delivered` + delivered event
 *   - opened     -> recipient.openedAt + open event
 *   - clicked    -> recipient.clickedAt + click event
 *
 * System scope: the webhook has no auth/org context; the org is derived from
 * the matched recipient's campaign.
 */
const handleResendWebhookImpl = async (
  db: DbConnection,
  input: HandleResendWebhookInput
): Promise<Result<HandleResendWebhookData>> => {
  const parsed = handleResendWebhookSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { type, emailId, to } = parsed.data;
  if (!emailId) return ok({ action: 'no_email_id' });

  const recipient = await db.query.campaignRecipient.findFirst({
    where: eq(campaignRecipient.providerMessageId, emailId),
  });
  if (!recipient) return ok({ action: 'unknown_recipient' });

  const camp = await db.query.campaign.findFirst({
    where: eq(campaign.id, recipient.campaignId),
    columns: { organizationId: true },
  });
  const organizationId = camp?.organizationId;
  const now = new Date();

  const suppress = async (reason: 'bounce' | 'complaint') => {
    if (!organizationId || !to) return;
    await db
      .insert(suppression)
      .values({
        organizationId,
        channel: 'email',
        contact: normalizeContact('email', to),
        reason,
        source: 'resend',
      })
      .onConflictDoNothing();
  };

  const event = async (eventType: 'delivered' | 'open' | 'click') => {
    await db.insert(campaignEvent).values({
      campaignId: recipient.campaignId,
      recipientId: recipient.id,
      type: eventType,
    });
  };

  switch (type) {
    case 'email.bounced':
      await db
        .update(campaignRecipient)
        .set({ status: 'bounced' })
        .where(eq(campaignRecipient.id, recipient.id));
      await suppress('bounce');
      break;
    case 'email.complained':
      await suppress('complaint');
      break;
    case 'email.delivered':
      await db
        .update(campaignRecipient)
        .set({ status: 'delivered', deliveredAt: now })
        .where(eq(campaignRecipient.id, recipient.id));
      await event('delivered');
      break;
    case 'email.opened':
      await db
        .update(campaignRecipient)
        .set({ openedAt: now })
        .where(eq(campaignRecipient.id, recipient.id));
      await event('open');
      break;
    case 'email.clicked':
      await db
        .update(campaignRecipient)
        .set({ clickedAt: now })
        .where(eq(campaignRecipient.id, recipient.id));
      await event('click');
      break;
    default:
      return ok({ action: 'ignored' });
  }

  return ok({ action: type });
};

export const handleResendWebhook = (
  db: DbConnection,
  input: HandleResendWebhookInput
) =>
  trackedResult(
    'campaigns.handleResendWebhook',
    () =>
      withSystemScope((conn) => handleResendWebhookImpl(conn, input), { db }),
    { properties: { type: input.type } }
  );

export type HandleResendWebhookResult = Awaited<
  ReturnType<typeof handleResendWebhook>
>;
