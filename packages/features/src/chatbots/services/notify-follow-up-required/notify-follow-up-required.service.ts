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
// Lazy-imported to avoid env validation at module load time (breaks tests)
// import { RequiresFollowUpEmail, sendEmail } from '@borradh-workspace/email';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  conversationInboxUrl,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type NotifyFollowUpRequiredInput,
  notifyFollowUpRequiredSchema,
} from './notify-follow-up-required.schema.js';

const logger = createLogger('NotifyFollowUpRequired');

const notifyFollowUpRequiredImpl = async (
  db: DbConnection,
  input: NotifyFollowUpRequiredInput
): Promise<Result<{ notified: boolean }>> => {
  const parsed = notifyFollowUpRequiredSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { conversationId, followUpReason } = parsed.data;

  // Load conversation with chatbot
  const conv = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
  });

  if (!conv) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found')
    );
  }

  // Load organization to get chatbot settings
  const orgRecord = await db.query.organization.findFirst({
    where: and(
      eq(organization.id, conv.organizationId),
      notDeleted(organization)
    ),
  });
  const settings: ChatbotSettings | null =
    (orgRecord?.chatbotSettings as ChatbotSettings | null) ?? null;

  // Determine recipient email: escalationEmail > org owner email
  let recipientEmail = settings?.escalationEmail;
  let recipientName = settings?.ownerName ?? 'there';

  if (!recipientEmail) {
    // Find the organization owner
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
      recipientEmail = ownerUser?.email;
      recipientName = ownerUser?.name ?? recipientName;
    }
  }

  if (!recipientEmail) {
    logger.warn('No recipient email found for follow-up notification', {
      conversationId,
      organizationId: conv.organizationId,
    });
    return ok({ notified: false });
  }

  // Build conversation snippet (last 6 messages)
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

  const metadata = (conv.metadata as ConversationMetadata | null) ?? {};
  const customerName =
    metadata.name ?? conv.externalUserName ?? 'Unknown customer';
  const platformLabel =
    messagingPlatformLabels[conv.platform as MessagingPlatform] ??
    conv.platform;

  // Lazy-load to avoid env validation at import time (breaks tests)
  const { apiEnv } = await import('@borradh-workspace/env/api');
  const { sendEmail, RequiresFollowUpEmail } = await import(
    '@borradh-workspace/email'
  );
  const dashboardUrl = apiEnv.WEB_URL
    ? conversationInboxUrl(apiEnv.APP_URL ?? apiEnv.WEB_URL, conversationId)
    : null;

  try {
    await sendEmail({
      to: recipientEmail,
      subject: `Requires Follow-Up: ${customerName} asked about ${followUpReason}`,
      template: RequiresFollowUpEmail,
      props: {
        ownerName: recipientName,
        customerName,
        platform: platformLabel,
        followUpReason,
        conversationSnippet: snippet,
        dashboardUrl,
        organizationName: orgRecord?.name ?? 'Your Business',
      },
    });

    // Mark that we notified so we don't send duplicates
    await db
      .update(conversation)
      .set({
        metadata: {
          ...metadata,
          followUpNotifiedAt: new Date().toISOString(),
        },
      })
      .where(eq(conversation.id, conversationId));

    logger.info('Follow-up notification email sent', {
      conversationId,
      recipientEmail,
      followUpReason,
    });

    return ok({ notified: true });
  } catch (error) {
    logError('chatbots.notifyFollowUpRequired', error, {
      feature: 'chatbots',
      extra: { conversationId, recipientEmail },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to send follow-up notification'
      )
    );
  }
};

export const notifyFollowUpRequired = (
  db: DbConnection,
  input: NotifyFollowUpRequiredInput
) =>
  trackedResult(
    'chatbots.notifyFollowUpRequired',
    () => notifyFollowUpRequiredImpl(db, input),
    {
      properties: { conversationId: input.conversationId },
    }
  );
