import {
  lead,
  suppression,
  withSystemScope,
} from '@borradh-workspace/database';
import { parseSmsKeyword } from '@borradh-workspace/integrations';
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
import { normalizeContact } from '../_shared/index.js';
import {
  type HandleSmsWebhookInput,
  handleSmsWebhookSchema,
} from './handle-sms-webhook.schema.js';

export interface HandleSmsWebhookData {
  action: 'opt_out' | 'opt_in' | 'ignored' | 'unknown_number';
  organizationId?: string;
}

/**
 * Process an inbound SMS from Twilio. STOP/UNSUBSCRIBE → add the sender to the
 * org's suppression list (SMS) AND flip the matching lead's `consentSms` off;
 * START/UNSTOP → reverse it. Anything else is ignored (v1 doesn't route replies).
 *
 * Runs under system scope: the inbound webhook has no auth/org context, and the
 * org is resolved from the Twilio number that received the message.
 */
const handleSmsWebhookImpl = async (
  db: DbConnection,
  input: HandleSmsWebhookInput
): Promise<Result<HandleSmsWebhookData>> => {
  const parsed = handleSmsWebhookSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const keyword = parseSmsKeyword(parsed.data.body);
  if (!keyword) return ok({ action: 'ignored' });

  const toNorm = normalizeContact('sms', parsed.data.to);
  const fromNorm = normalizeContact('sms', parsed.data.from);

  // Resolve the org from the receiving number (normalize both sides to be
  // robust to formatting). Small table at current scale.
  const numbers = await db.query.orgSmsNumber.findMany({
    columns: { organizationId: true, phoneNumber: true },
  });
  const match = numbers.find(
    (n) => normalizeContact('sms', n.phoneNumber) === toNorm
  );
  if (!match) return ok({ action: 'unknown_number' });
  const organizationId = match.organizationId;

  if (keyword === 'opt_out') {
    await db
      .insert(suppression)
      .values({
        organizationId,
        channel: 'sms',
        contact: fromNorm,
        reason: 'stop',
        source: 'twilio_inbound',
      })
      .onConflictDoNothing();
    // Best-effort consent flip (suppression is the authoritative block).
    await db
      .update(lead)
      .set({ consentSms: false })
      .where(
        and(
          eq(lead.organizationId, organizationId),
          eq(lead.phone, parsed.data.from)
        )
      );
  } else {
    // opt_in — clear the suppression and restore consent.
    await db
      .delete(suppression)
      .where(
        and(
          eq(suppression.organizationId, organizationId),
          eq(suppression.channel, 'sms'),
          eq(suppression.contact, fromNorm)
        )
      );
    await db
      .update(lead)
      .set({ consentSms: true })
      .where(
        and(
          eq(lead.organizationId, organizationId),
          eq(lead.phone, parsed.data.from)
        )
      );
  }

  return ok({ action: keyword, organizationId });
};

export const handleSmsWebhook = (
  db: DbConnection,
  input: HandleSmsWebhookInput
) =>
  trackedResult(
    'campaigns.handleSmsWebhook',
    () => withSystemScope((conn) => handleSmsWebhookImpl(conn, input), { db }),
    { properties: { to: input.to } }
  );

export type HandleSmsWebhookResult = Awaited<
  ReturnType<typeof handleSmsWebhook>
>;
