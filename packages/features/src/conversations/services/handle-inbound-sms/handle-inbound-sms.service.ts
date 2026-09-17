import { trackedResult } from '@borradh-workspace/observability';

import { handleSmsWebhook } from '../../../campaigns/index.js';
import type { DbConnection, Result } from '../../../shared/index.js';
import { ok } from '../../../shared/index.js';
import { handleIncomingMessage } from '../handle-incoming-message/index.js';
import {
  type HandleInboundSmsInput,
  handleInboundSmsSchema,
} from './handle-inbound-sms.schema.js';

export interface HandleInboundSmsData {
  /** What the consent layer did with the message. */
  consentAction: 'opt_out' | 'opt_in' | 'ignored' | 'unknown_number' | 'error';
  /** Whether the body was handed to Claire's pipeline. */
  routedToClaire: boolean;
}

/**
 * Orchestrate one inbound SMS from Twilio.
 *
 * Two things have to happen in a fixed order:
 *
 *  1. **Consent, and it wins.** STOP/START is honoured before anything else
 *     looks at the message. A contact who just opted out must never reach
 *     Claire, so a consent keyword terminates handling here.
 *  2. **Everything else is a real reply** and goes into the same
 *     `handleIncomingMessage` entry point Messenger, Instagram and WhatsApp
 *     use — Claire must not grow a second, SMS-shaped pipeline.
 *
 * Neither step is allowed to fail the webhook: Twilio retries non-2xx, and a
 * retry would re-deliver a message we already recorded. Failures are reported
 * in the result for logging and the webhook still answers OK.
 */
const handleInboundSmsImpl = async (
  db: DbConnection,
  input: HandleInboundSmsInput
): Promise<Result<HandleInboundSmsData>> => {
  const parsed = handleInboundSmsSchema.safeParse(input);
  if (!parsed.success) {
    return ok({ consentAction: 'error', routedToClaire: false });
  }

  const { from, to, body, messageId } = parsed.data;

  const consent = await handleSmsWebhook(db, { from, to, body });
  const consentAction = consent.success ? consent.data.action : 'error';

  // A consent keyword is the whole message — there is no reply to answer.
  if (consentAction === 'opt_out' || consentAction === 'opt_in') {
    return ok({ consentAction, routedToClaire: false });
  }

  if (!body.trim()) {
    return ok({ consentAction, routedToClaire: false });
  }

  const incoming = await handleIncomingMessage(db, {
    // SMS has no page; the receiving number is the routing key, and the sender
    // disambiguates it when several orgs share that number.
    pageId: to,
    senderId: from,
    messageText: body,
    messageId,
    platform: 'sms',
  });

  return ok({ consentAction, routedToClaire: incoming.success });
};

export const handleInboundSms = (
  db: DbConnection,
  input: HandleInboundSmsInput
) =>
  trackedResult(
    'conversations.handleInboundSms',
    () => handleInboundSmsImpl(db, input),
    { properties: { to: input.to } }
  );

export type HandleInboundSmsResult = Awaited<
  ReturnType<typeof handleInboundSms>
>;
