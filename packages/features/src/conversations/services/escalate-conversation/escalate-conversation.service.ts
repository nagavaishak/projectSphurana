import { conversation, conversationMessage } from '@borradh-workspace/database';
import type { ConversationMetadata } from '@borradh-workspace/database';
import { withOrgScope } from '@borradh-workspace/database';
import {
  createLogger,
  logError,
  trackOrgEvent,
  trackedResult,
} from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';

import {
  cancelPendingFlow,
  cancelPendingFollowUp,
  cancelPendingMessageParts,
  cancelResponseTimeout,
} from '../../../chatbots/services/queue-chatbot-flow/queue-chatbot-flow.service.js';
import { hasRecentNotification } from '../../../notifications/services/_shared/recent-notification.js';
import { dispatchNotification } from '../../../notifications/services/dispatch-notification/dispatch-notification.service.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  conversationInboxPath,
  err,
  logConversationEvent,
  ok,
} from '../../../shared/index.js';
import {
  type EscalateConversationInput,
  escalateConversationSchema,
} from './escalate-conversation.schema.js';
import { notifyAgentsOfEscalation } from './notify-agents.js';

const logger = createLogger('EscalateConversation');

const escalateConversationImpl = async (
  db: DbConnection,
  input: EscalateConversationInput
): Promise<Result<{ escalated: boolean }>> => {
  const parsed = escalateConversationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    conversationId,
    reason,
    reasonDetail,
    notifyAgents,
    insertSystemMessage,
  } = parsed.data;

  try {
    const conv = await db.query.conversation.findFirst({
      where: eq(conversation.id, conversationId),
    });

    if (!conv) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found')
      );
    }

    // Idempotent: skip if already agent_handling
    if (conv.status === 'agent_handling') {
      logger.info('Conversation already agent_handling, skipping escalation', {
        conversationId,
        reason,
      });
      return ok({ escalated: false });
    }

    // Update conversation status and metadata
    const existingMeta = (conv.metadata as ConversationMetadata | null) ?? {};
    await db
      .update(conversation)
      .set({
        status: 'agent_handling',
        metadata: {
          ...existingMeta,
          escalationReason: reason,
          escalationDetail: reasonDetail,
          escalatedAt: new Date().toISOString(),
        },
      })
      .where(eq(conversation.id, conversationId));

    // Product analytics: real bot→human transition (the early-return above
    // guarantees we were not already agent_handling). Paired with
    // conversation_created for the handoff-rate metric.
    trackOrgEvent(conv.organizationId, 'conversation_handed_off', {
      organizationId: conv.organizationId,
      conversationId,
      source: `escalation:${reason}`,
    });

    // Cancel ALL pending bot jobs
    await cancelResponseTimeout(conversationId);
    await cancelPendingMessageParts(conversationId);
    await cancelPendingFollowUp(conversationId);
    await cancelPendingFlow(conversationId);

    // Insert system message
    if (insertSystemMessage) {
      await db.insert(conversationMessage).values({
        conversationId,
        role: 'system',
        content: 'Conversation handed off to a team member.',
        messageType: 'text',
        origin: 'live',
        sentAt: new Date(),
      });
    }

    // Send notifications (fire-and-forget)
    if (notifyAgents) {
      notifyAgentsOfEscalation(db, {
        conversationId,
        reason,
        reasonDetail,
      }).catch((notifyError) => {
        logger.warn('Failed to send escalation notifications', {
          conversationId,
          error:
            notifyError instanceof Error
              ? notifyError.message
              : String(notifyError),
        });
      });

      // Fire-and-forget in-app notification.
      //
      // A brand-new lead that messages and is immediately escalated is ONE
      // arrival — it already produced a `lead_created` ping seconds ago, so
      // sending a handoff too would double-ping for the same event. Suppress
      // this one when that just happened; a handoff later in an existing
      // conversation falls outside the window and still notifies.
      (async () => {
        // A failed dedup check must degrade to sending: a duplicate ping is a
        // nuisance, a dropped "conversation needs you" is a lost customer.
        const alreadyNotified = await hasRecentNotification(db, {
          organizationId: conv.organizationId,
          type: 'lead_created',
          dataKey: 'conversationId',
          dataValue: conversationId,
        }).catch(() => false);
        if (alreadyNotified) {
          logger.info('Suppressed handoff notification — lead just notified', {
            conversationId,
            organizationId: conv.organizationId,
          });
          return;
        }
        await dispatchNotification(db, {
          organizationId: conv.organizationId,
          type: 'chatbot_handoff',
          assigneeUserId: conv.assignedToId ?? undefined,
          title: 'Conversation needs you',
          body: 'A conversation has been handed off from the chatbot and needs a team member.',
          linkPath: conversationInboxPath(conversationId),
        });
      })().catch((notifyError) => {
        logError(
          'conversations.escalateConversation.dispatchNotification',
          notifyError,
          {
            feature: 'conversations',
            extra: { conversationId, reason },
          }
        );
      });
    }

    logger.info('Conversation escalated', {
      conversationId,
      organizationId: conv.organizationId,
      platform: conv.platform,
      reason,
      reasonDetail,
    });

    await logConversationEvent(db, {
      organizationId: conv.organizationId,
      conversationId,
      event: 'escalated',
      metadata: { reason, reasonDetail, platform: conv.platform },
    });

    return ok({ escalated: true });
  } catch (error) {
    logError('conversations.escalateConversation', error, {
      feature: 'conversations',
      extra: { conversationId, reason },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to escalate conversation'
      )
    );
  }
};

export const escalateConversation = (
  db: DbConnection,
  input: EscalateConversationInput
) =>
  trackedResult(
    'conversations.escalateConversation',
    () => withOrgScope((tx) => escalateConversationImpl(tx, input), { db }),
    {
      properties: {
        conversationId: input.conversationId,
        reason: input.reason,
      },
    }
  );

export type EscalateConversationResult = Awaited<
  ReturnType<typeof escalateConversation>
>;
