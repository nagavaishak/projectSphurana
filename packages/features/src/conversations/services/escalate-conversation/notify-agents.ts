import {
  conversation,
  conversationMessage,
  member,
  organization,
  user,
} from '@borradh-workspace/database';
import type {
  ChatbotSettings,
  ConversationMetadata,
  MessagingPlatform,
} from '@borradh-workspace/database';
import { messagingPlatformLabels } from '@borradh-workspace/labels';
import { createLogger, logError } from '@borradh-workspace/observability';
import { and, desc, eq } from 'drizzle-orm';

import { sendPushNotification } from '../../../notifications/services/send-push-notification/send-push-notification.service.js';
import {
  type DbConnection,
  conversationInboxUrl,
  notDeleted,
} from '../../../shared/index.js';
import type { EscalationReason } from './escalate-conversation.schema.js';

const logger = createLogger('NotifyAgentsEscalation');

const ESCALATION_REASON_LABELS: Record<EscalationReason, string> = {
  ai_handoff: 'AI handed off conversation',
  ai_silent_handoff: 'Chatbot chose not to respond',
  needs_follow_up: 'Customer needs follow-up',
  inappropriate_content: 'Inappropriate content detected',
  user_requested_human: 'Customer requested a human',
  agent_takeover: 'Agent took over conversation',
  max_follow_ups: 'Maximum follow-ups reached',
  delivery_failed: 'Bot reply could not be delivered',
  manual: 'Manual escalation',
};

interface NotifyAgentsInput {
  conversationId: string;
  reason: EscalationReason;
  reasonDetail?: string;
}

export async function notifyAgentsOfEscalation(
  db: DbConnection,
  input: NotifyAgentsInput
): Promise<void> {
  const { conversationId, reason, reasonDetail } = input;

  try {
    const conv = await db.query.conversation.findFirst({
      where: eq(conversation.id, conversationId),
    });
    if (!conv) return;

    const orgRecord = await db.query.organization.findFirst({
      where: and(
        eq(organization.id, conv.organizationId),
        notDeleted(organization)
      ),
    });
    const settings = orgRecord?.chatbotSettings as ChatbotSettings | null;
    const metadata = (conv.metadata as ConversationMetadata | null) ?? {};
    const customerName =
      metadata.name ?? conv.externalUserName ?? 'Unknown customer';
    const platformLabel =
      messagingPlatformLabels[conv.platform as MessagingPlatform] ??
      conv.platform;
    const reasonLabel = ESCALATION_REASON_LABELS[reason];

    // Resolve notification recipients: assigned agent → org owner → admins
    const recipientUserIds: string[] = [];
    let recipientEmail: string | undefined;
    let recipientName = settings?.ownerName ?? 'there';

    if (conv.assignedToId) {
      recipientUserIds.push(conv.assignedToId);
    }

    recipientEmail = settings?.escalationEmail;

    if (!recipientEmail || recipientUserIds.length === 0) {
      const ownerMember = await db.query.member.findFirst({
        where: and(
          eq(member.organizationId, conv.organizationId),
          eq(member.role, 'owner')
        ),
      });

      if (ownerMember) {
        const ownerUser = await db.query.user.findFirst({
          where: eq(user.id, ownerMember.userId),
        });
        if (ownerUser) {
          if (!recipientEmail) recipientEmail = ownerUser.email;
          recipientName = ownerUser.name ?? recipientName;
          if (!recipientUserIds.includes(ownerMember.userId)) {
            recipientUserIds.push(ownerMember.userId);
          }
        }
      }
    }

    // Send push notification to each recipient
    const pushTitle = 'Conversation Escalated';
    const pushBody = `${customerName} (${platformLabel}): ${reasonLabel}${reasonDetail ? ` — ${reasonDetail}` : ''}`;

    for (const userId of recipientUserIds) {
      sendPushNotification(db, {
        userId,
        title: pushTitle,
        body: pushBody,
        data: {
          type: 'conversation_escalation',
          conversationId,
          reason,
        },
      }).catch((pushErr) => {
        logger.warn('Failed to send escalation push notification', {
          userId,
          conversationId,
          error: pushErr instanceof Error ? pushErr.message : String(pushErr),
        });
      });
    }

    // Send email notification
    if (recipientEmail) {
      const recentMessages = await db.query.conversationMessage.findMany({
        where: eq(conversationMessage.conversationId, conversationId),
        orderBy: [desc(conversationMessage.createdAt)],
        limit: 6,
      });

      const snippet = recentMessages
        .reverse()
        .map((m) => {
          const role =
            m.role === 'user'
              ? (conv.externalUserName ?? 'Customer')
              : m.role === 'bot'
                ? 'Claire'
                : m.role;
          return `${role}: ${m.content}`;
        })
        .join('\n');

      try {
        const { apiEnv } = await import('@borradh-workspace/env/api');
        const { sendEmail, RequiresFollowUpEmail } = await import(
          '@borradh-workspace/email'
        );
        const dashboardUrl = apiEnv.WEB_URL
          ? conversationInboxUrl(
              apiEnv.APP_URL ?? apiEnv.WEB_URL,
              conversationId
            )
          : null;

        await sendEmail({
          to: recipientEmail,
          subject: `Escalated: ${customerName} — ${reasonLabel}`,
          template: RequiresFollowUpEmail,
          props: {
            ownerName: recipientName,
            customerName,
            platform: platformLabel,
            followUpReason: reasonDetail ?? reasonLabel,
            conversationSnippet: snippet,
            dashboardUrl,
            organizationName: orgRecord?.name ?? 'Your Business',
          },
        });
      } catch (emailError) {
        logError('conversations.escalation.email', emailError, {
          feature: 'conversations',
          extra: { conversationId, recipientEmail },
        });
      }
    }

    logger.info('Escalation notifications sent', {
      conversationId,
      reason,
      pushRecipients: recipientUserIds.length,
      emailSent: !!recipientEmail,
    });
  } catch (error) {
    logError('conversations.escalation.notify', error, {
      feature: 'conversations',
      extra: { conversationId },
    });
  }
}
