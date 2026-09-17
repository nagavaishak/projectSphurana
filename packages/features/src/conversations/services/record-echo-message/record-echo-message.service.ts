import {
  conversation,
  conversationMessage,
  isUniqueViolation,
} from '@borradh-workspace/database';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, between, desc, eq, isNull } from 'drizzle-orm';

import {
  cancelPendingFlow,
  cancelPendingFollowUp,
  cancelPendingMessageParts,
  cancelResponseTimeout,
} from '../../../chatbots/services/queue-chatbot-flow/queue-chatbot-flow.service.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  logConversationEvent,
  ok,
} from '../../../shared/index.js';
import { resolveTenantContext } from '../handle-incoming-message/resolve-message-context.js';
import { classifyEchoOrigin } from './classify-echo-origin.js';
import {
  type RecordEchoMessageInput,
  recordEchoMessageSchema,
} from './record-echo-message.schema.js';

const logger = createLogger('RecordEchoMessage');

const ECHO_MATCH_WINDOW_MS = 5_000;

const recordEchoMessageImpl = async (
  db: DbConnection,
  input: RecordEchoMessageInput
): Promise<Result<{ recorded: boolean; role?: 'bot' | 'agent' }>> => {
  const parsed = recordEchoMessageSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    // Resolve tenant context first so the conversation lookup is scoped by
    // organizationId. Without this, WhatsApp echoes can cross-route between
    // orgs — `externalUserId` is a phone number on WhatsApp and the same
    // phone may exist in multiple orgs' conversations. Also defensively
    // applies to Messenger/Instagram.
    const context = await resolveTenantContext(
      db,
      parsed.data.platform,
      parsed.data.pageId
    );

    if (!context) {
      logger.warn('No tenant context for echo', {
        pageId: parsed.data.pageId,
        platform: parsed.data.platform,
      });
      return ok({ recorded: false });
    }

    const conv = await db.query.conversation.findFirst({
      where: and(
        eq(conversation.organizationId, context.organizationId),
        eq(conversation.externalUserId, parsed.data.externalUserId),
        eq(conversation.platform, parsed.data.platform)
      ),
    });

    if (!conv) {
      return ok({ recorded: false });
    }

    const existing = await db.query.conversationMessage.findFirst({
      where: eq(
        conversationMessage.externalMessageId,
        parsed.data.externalMessageId
      ),
    });

    if (existing) {
      return ok({ recorded: false });
    }

    const echoTimestamp = parsed.data.timestamp
      ? new Date(parsed.data.timestamp)
      : new Date();
    const content = parsed.data.messageText ?? '';

    // Check for a local record with matching content but no externalMessageId (backfill ext_id)
    const windowStart = new Date(
      echoTimestamp.getTime() - ECHO_MATCH_WINDOW_MS
    );
    const windowEnd = new Date(echoTimestamp.getTime() + ECHO_MATCH_WINDOW_MS);

    const localMatch = await db.query.conversationMessage.findFirst({
      where: and(
        eq(conversationMessage.conversationId, conv.id),
        eq(conversationMessage.content, content),
        between(conversationMessage.sentAt, windowStart, windowEnd),
        isNull(conversationMessage.externalMessageId)
      ),
    });

    if (localMatch) {
      // Check-then-update race: two concurrent echoes can both select the
      // same `localMatch` and both try to backfill it, so the loser's UPDATE
      // can violate the partial unique index (idx_conversation_message_ext_id)
      // it is itself trying to satisfy. Treat that as "someone else already
      // recorded it" rather than letting it escape as an INTERNAL_ERROR.
      try {
        await db
          .update(conversationMessage)
          .set({ externalMessageId: parsed.data.externalMessageId })
          .where(eq(conversationMessage.id, localMatch.id));
      } catch (updateError) {
        if (
          !isUniqueViolation(updateError, 'idx_conversation_message_ext_id')
        ) {
          throw updateError;
        }
      }

      logger.info('Backfilled externalMessageId on local message', {
        conversationId: conv.id,
        messageId: localMatch.id,
        externalMessageId: parsed.data.externalMessageId,
        role: localMatch.role,
      });

      return ok({ recorded: true, role: localMatch.role as 'bot' | 'agent' });
    }

    // No local match → this echo came from the page itself, not from us. It's
    // either a human agent replying in Meta's inbox, or the page's own
    // auto-responder (Instant Reply / away / greeting message). Classify which:
    // an auto-responder must NOT trigger an agent takeover, otherwise the lead
    // gets one canned auto-reply and then silence — we'd cancel the bot even
    // though nobody is actually there.
    //
    // Detection is by latency to the lead's last inbound (see
    // classify-echo-origin). We deliberately do NOT gate on this being the
    // page's first reply: our own bot usually replies first, which would push
    // the auto-responder out of first position and hide it.
    const lastInbound = await db.query.conversationMessage.findFirst({
      where: and(
        eq(conversationMessage.conversationId, conv.id),
        eq(conversationMessage.role, 'user')
      ),
      orderBy: [desc(conversationMessage.sentAt)],
    });

    const msSinceLastInbound = lastInbound?.sentAt
      ? echoTimestamp.getTime() - new Date(lastInbound.sentAt).getTime()
      : null;

    const verdict = classifyEchoOrigin({ msSinceLastInbound, text: content });

    const result = await db
      .insert(conversationMessage)
      .values({
        conversationId: conv.id,
        // Recorded as an agent-side message either way (it's the page replying).
        // The auto-responder flag distinguishes automation from a real human.
        role: 'agent',
        content,
        messageType: 'text',
        externalMessageId: parsed.data.externalMessageId,
        origin: 'live',
        sentAt: echoTimestamp,
        metadata: verdict.isAutoResponder ? { autoResponder: true } : undefined,
      })
      .onConflictDoNothing()
      .returning();

    if (!result.length) {
      return ok({ recorded: false });
    }

    // An auto-responder must NOT flip the conversation to agent_handling; only a
    // genuine human reply does. `triggeredTakeover` is the human-takeover subset.
    const isAutoResponder = verdict.isAutoResponder;
    const triggeredTakeover =
      !isAutoResponder && conv.status !== 'agent_handling';

    if (isAutoResponder) {
      // Page auto-responder, not a human: leave the conversation status alone so
      // the bot stays in charge and actually engages the lead. Just bump
      // activity so the inbox ordering reflects the new message.
      await db
        .update(conversation)
        .set({ lastMessageAt: new Date() })
        .where(eq(conversation.id, conv.id));

      logger.info('Auto-responder echo detected; keeping bot in charge', {
        conversationId: conv.id,
        externalMessageId: parsed.data.externalMessageId,
        signals: verdict.signals,
      });

      await logConversationEvent(db, {
        organizationId: conv.organizationId,
        conversationId: conv.id,
        event: 'auto_responder_detected',
        metadata: {
          platform: parsed.data.platform,
          signals: verdict.signals,
        },
      });
    } else if (triggeredTakeover) {
      // Genuine human reply via the page → agent takeover.
      await db
        .update(conversation)
        .set({ status: 'agent_handling', lastMessageAt: new Date() })
        .where(eq(conversation.id, conv.id));

      await cancelResponseTimeout(conv.id);
      await cancelPendingMessageParts(conv.id);
      await cancelPendingFollowUp(conv.id);
      await cancelPendingFlow(conv.id);

      logger.info('Agent takeover via echo', {
        conversationId: conv.id,
        externalMessageId: parsed.data.externalMessageId,
      });

      await logConversationEvent(db, {
        organizationId: conv.organizationId,
        conversationId: conv.id,
        event: 'agent_takeover',
        metadata: { platform: parsed.data.platform },
      });
    } else {
      // Foreign echo that neither auto-responds nor takes over (e.g. the page
      // replying while already in agent_handling). Just bump activity.
      await db
        .update(conversation)
        .set({ lastMessageAt: new Date() })
        .where(eq(conversation.id, conv.id));
    }

    // Maximum echo observability: one durable, queryable event per echo with
    // every discriminating signal, so "what was this echo and what did it do?"
    // is answerable without log archaeology. `agent_takeover` /
    // `auto_responder_detected` (above) only fire on the subset that flips (or
    // deliberately keeps) the conversation — this fires for ALL foreign echoes
    // (humans and page auto-responders alike).
    await logConversationEvent(db, {
      organizationId: conv.organizationId,
      conversationId: conv.id,
      event: 'echo_received',
      metadata: {
        platform: parsed.data.platform,
        role: 'agent',
        triggeredTakeover,
        autoResponder: isAutoResponder,
        appId: parsed.data.appId ?? null,
        isOwnAppEcho: parsed.data.isOwnAppEcho ?? false,
        contentLength: content.length,
        isEmpty: content.trim().length === 0,
        attachmentTypes: parsed.data.attachmentTypes ?? [],
        hasAppMetadata: parsed.data.hasAppMetadata ?? false,
      },
    });

    logger.info('Recorded echo message', {
      conversationId: conv.id,
      role: 'agent',
      triggeredTakeover,
      autoResponder: isAutoResponder,
      appId: parsed.data.appId ?? null,
      isOwnAppEcho: parsed.data.isOwnAppEcho ?? false,
      isEmpty: content.trim().length === 0,
      attachmentTypes: parsed.data.attachmentTypes ?? [],
      externalMessageId: parsed.data.externalMessageId,
    });

    return ok({ recorded: true, role: 'agent' });
  } catch (error) {
    logError('conversations.recordEchoMessage', error, {
      feature: 'conversations',
      extra: {
        pageId: parsed.data.pageId,
        externalUserId: parsed.data.externalUserId,
      },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to record echo message'
      )
    );
  }
};

export const recordEchoMessage = (
  db: DbConnection,
  input: RecordEchoMessageInput
) =>
  trackedResult(
    'conversations.recordEchoMessage',
    () => recordEchoMessageImpl(db, input),
    {
      properties: {
        pageId: input.pageId,
        platform: input.platform,
      },
    }
  );

export type RecordEchoMessageResult = Awaited<
  ReturnType<typeof recordEchoMessage>
>;
