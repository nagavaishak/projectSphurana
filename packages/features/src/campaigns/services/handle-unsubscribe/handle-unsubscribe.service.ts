import {
  campaign,
  campaignEvent,
  campaignRecipient,
  lead,
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
import {
  contactForChannel,
  normalizeContact,
  verifyTrackingToken,
} from '../_shared/index.js';
import { getTrackingSecret } from '../_shared/tracking-secret.js';
import {
  type HandleUnsubscribeInput,
  handleUnsubscribeSchema,
} from './handle-unsubscribe.schema.js';

export interface HandleUnsubscribeData {
  action: 'unsubscribed' | 'invalid' | 'unknown_recipient';
}

/**
 * Process a one-click unsubscribe (RFC 8058). Verifies the HMAC token, then
 * adds the recipient's contact to the org suppression list for that channel,
 * marks the recipient `opted_out`, and records an unsubscribe event. Runs under
 * system scope (public route, no auth/org context). Always returns a generic
 * success so the public page never leaks whether a token was valid.
 */
const handleUnsubscribeImpl = async (
  db: DbConnection,
  input: HandleUnsubscribeInput
): Promise<Result<HandleUnsubscribeData>> => {
  const parsed = handleUnsubscribeSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const payload = verifyTrackingToken(parsed.data.token, getTrackingSecret());
  if (!payload) return ok({ action: 'invalid' });

  const recipient = await db.query.campaignRecipient.findFirst({
    where: eq(campaignRecipient.id, payload.r),
  });
  if (!recipient) return ok({ action: 'unknown_recipient' });

  const camp = await db.query.campaign.findFirst({
    where: eq(campaign.id, recipient.campaignId),
    columns: { organizationId: true },
  });
  const leadRow = await db.query.lead.findFirst({
    where: eq(lead.id, recipient.leadId),
    columns: { email: true, phone: true, whatsapp: true },
  });

  const organizationId = camp?.organizationId;
  const contact = leadRow
    ? contactForChannel(
        {
          id: recipient.leadId,
          email: leadRow.email,
          phone: leadRow.phone,
          whatsapp: leadRow.whatsapp,
          consentEmail: false,
          consentSms: false,
        },
        payload.c
      )
    : null;

  if (organizationId && contact) {
    await db
      .insert(suppression)
      .values({
        organizationId,
        channel: payload.c,
        contact: normalizeContact(payload.c, contact),
        reason: 'unsubscribe',
        source: 'one_click',
      })
      .onConflictDoNothing();
    await db
      .update(campaignRecipient)
      .set({ status: 'opted_out' })
      .where(eq(campaignRecipient.id, recipient.id));
    await db.insert(campaignEvent).values({
      campaignId: recipient.campaignId,
      recipientId: recipient.id,
      type: 'unsubscribe',
    });
  }

  return ok({ action: 'unsubscribed' });
};

export const handleUnsubscribe = (
  db: DbConnection,
  input: HandleUnsubscribeInput
) =>
  trackedResult(
    'campaigns.handleUnsubscribe',
    () => withSystemScope((conn) => handleUnsubscribeImpl(conn, input), { db }),
    {}
  );

export type HandleUnsubscribeResult = Awaited<
  ReturnType<typeof handleUnsubscribe>
>;
