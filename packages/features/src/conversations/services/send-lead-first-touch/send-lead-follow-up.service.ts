import {
  conversation,
  conversationMessage,
  lead,
  organization,
  whatsappAccount,
  whatsappTemplate,
} from '@borradh-workspace/database';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { WhatsAppCloudService } from '@borradh-workspace/integrations/whatsapp';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, desc, eq } from 'drizzle-orm';

import { deliverMessages } from '../../../chatbots/index.js';
import { advanceLeadStage } from '../../../leads/index.js';
import { type DbConnection, type Result, ok } from '../../../shared/index.js';
import {
  FOLLOW_UP_TEMPLATE_NAMES,
  type FollowUpStep,
  composeFollowUp,
} from './compose-first-touch.js';

const logger = createLogger('SendLeadFollowUp');

export type FollowUpOutcome =
  | { sent: true; step: FollowUpStep }
  | {
      sent: false;
      reason:
        | 'lead_replied'
        | 'conversation_not_found'
        | 'lead_not_found'
        | 'no_template'
        | 'delivery_failed';
    };

/**
 * One follow-up nudge to a lead who has not answered the opener.
 *
 * **The stop condition is checked here, at fire time, not by cancelling the
 * job.** A delayed job that no-ops is harmless; a cancellation that silently
 * fails is a lead being nudged after they already replied. Checking on wake
 * also survives a reply that arrives while the job is in flight.
 */
const sendLeadFollowUpImpl = async (
  db: DbConnection,
  input: {
    organizationId: string;
    leadId: string;
    conversationId: string;
    step: FollowUpStep;
  }
): Promise<Result<FollowUpOutcome>> => {
  const { organizationId, leadId, conversationId, step } = input;

  const conv = await db.query.conversation.findFirst({
    where: and(
      eq(conversation.id, conversationId),
      eq(conversation.organizationId, organizationId)
    ),
  });
  if (!conv) return ok({ sent: false, reason: 'conversation_not_found' });

  // Any message from the lead means the nudge is unwanted — they are in a
  // conversation with Claire and she will handle it.
  const reply = await db.query.conversationMessage.findFirst({
    where: and(
      eq(conversationMessage.conversationId, conversationId),
      eq(conversationMessage.role, 'user')
    ),
    orderBy: [desc(conversationMessage.sentAt)],
  });
  if (reply) return ok({ sent: false, reason: 'lead_replied' });

  const [leadRow, org] = await Promise.all([
    db.query.lead.findFirst({ where: eq(lead.id, leadId) }),
    db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
    }),
  ]);
  if (!leadRow || !org) return ok({ sent: false, reason: 'lead_not_found' });

  const composed = composeFollowUp(step, {
    firstName: leadRow.firstName,
    clinicName: org.name,
  });

  let delivered = false;

  if (conv.platform === 'whatsapp') {
    const [waAccount, template] = await Promise.all([
      db.query.whatsappAccount.findFirst({
        where: eq(whatsappAccount.id, conv.whatsappAccountId ?? ''),
      }),
      db.query.whatsappTemplate.findFirst({
        where: and(
          eq(whatsappTemplate.organizationId, organizationId),
          eq(whatsappTemplate.name, FOLLOW_UP_TEMPLATE_NAMES[step]),
          eq(whatsappTemplate.status, 'approved')
        ),
      }),
    ]);
    if (!waAccount || !template) {
      return ok({ sent: false, reason: 'no_template' });
    }

    try {
      const credentials = decryptCredentials<{ accessToken: string }>(
        waAccount.encryptedCredentials
      );
      const whatsapp = new WhatsAppCloudService(
        credentials.accessToken,
        waAccount.phoneNumberId
      );
      const result = await whatsapp.sendTemplateMessage({
        to: conv.externalUserId,
        templateName: template.name,
        languageCode: template.languageCode,
        parameters: Object.fromEntries(
          composed.templateParameters.map((v, i) => [String(i), v])
        ),
      });
      if (result.success) {
        await db.insert(conversationMessage).values({
          conversationId,
          role: 'bot',
          content: composed.body,
          messageType: 'text',
          externalMessageId: result.messageId || null,
          sentAt: new Date(),
        });
        delivered = true;
      }
    } catch (error) {
      logError('conversations.sendLeadFollowUp.whatsapp', error, {
        feature: 'conversations',
        extra: { conversationId, organizationId, step },
      });
    }
  } else {
    delivered =
      (
        await deliverMessages({
          db,
          conversationId,
          messages: [{ type: 'text', text: composed.body }],
        })
      ).delivered > 0;
  }

  if (!delivered) return ok({ sent: false, reason: 'delivery_failed' });

  logger.info('Sent follow-up', { conversationId, leadId, step });

  // Second nudge sent with no reply: the sequence is over. `lost` records that
  // we tried and stopped, which is what makes the lead list honest. It is the
  // one stage that must be WRITTEN — every other stage is derived from what
  // happened, and nothing in the data says "we gave up on them". (`cold` was
  // the old name for this and is retired; see the stage vocabulary in
  // packages/labels/src/leads.ts.)
  if (step === 'followup_2') {
    await advanceLeadStage(db, { leadId, from: 'contacted', to: 'lost' });
  }

  return ok({ sent: true, step });
};

export const sendLeadFollowUp = (
  db: DbConnection,
  input: {
    organizationId: string;
    leadId: string;
    conversationId: string;
    step: FollowUpStep;
  }
) =>
  trackedResult(
    'conversations.sendLeadFollowUp',
    () => sendLeadFollowUpImpl(db, input),
    { properties: { leadId: input.leadId, step: input.step } }
  );
