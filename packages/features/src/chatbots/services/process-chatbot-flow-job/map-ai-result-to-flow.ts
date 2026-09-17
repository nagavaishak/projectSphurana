import type { ConversationMetadata } from '@borradh-workspace/database';
import { conversation } from '@borradh-workspace/database';
import { createLogger } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';
import type { FlowExecutionResult } from '../execute-flow/index.js';
import type { AIResponseResult } from '../generate-ai-response/index.js';

const logger = createLogger('MapAIResultToFlow');

/**
 * Map an AI response result to a FlowExecutionResult shape.
 * Builds metadata updates from extended AI response fields (treatments, booking, etc.).
 */
export async function mapAIResultToFlowResult(
  db: DbConnection,
  conversationId: string,
  aiResult: AIResponseResult,
  bookingLink?: string | null
): Promise<FlowExecutionResult> {
  const {
    message: aiMessage,
    action,
    collectedData,
    silentHandoffReason,
    ownerNotification,
    stage,
    treatmentsMentioned,
    healthConcernDetected,
    bookingInterest,
    bookingLinkSent,
    bookingPushed,
    needsFollowUp,
    followUpReason,
    bookingCompleted,
  } = aiResult;

  const flowResult: FlowExecutionResult = {
    messages: [{ type: 'text', text: aiMessage }],
    newNodeId: null,
    stoppedAt: 'waiting',
  };

  if (action === 'silent_handoff') {
    flowResult.stoppedAt = 'silent_handoff';
    flowResult.setAgentHandling = true;
    flowResult.messages = []; // No message sent to customer
  } else if (action === 'handoff') {
    flowResult.stoppedAt = 'handoff';
    flowResult.setAgentHandling = true;
  } else if (action === 'end') {
    flowResult.stoppedAt = 'end';
  }

  // Build metadata updates from extended AI response fields
  const metadataUpdates: Record<string, unknown> = {};

  if (collectedData && Object.keys(collectedData).length > 0) {
    Object.assign(metadataUpdates, collectedData);
  }

  if (stage) {
    metadataUpdates.stage = stage;
  }

  // Fetch existing metadata once if needed for treatments or booking push count
  const needsExistingMeta =
    (treatmentsMentioned && treatmentsMentioned.length > 0) || bookingPushed;
  let existingMeta: ConversationMetadata = {};
  if (needsExistingMeta) {
    const conv = await db.query.conversation.findFirst({
      where: eq(conversation.id, conversationId),
    });
    existingMeta = (conv?.metadata as ConversationMetadata | null) ?? {};
  }

  if (treatmentsMentioned && treatmentsMentioned.length > 0) {
    const existing = existingMeta.treatmentsDiscussed ?? [];
    const merged = [...new Set([...existing, ...treatmentsMentioned])];
    metadataUpdates.treatmentsDiscussed = merged;
  }

  if (healthConcernDetected) {
    metadataUpdates.healthConcerns = ['detected'];
  }

  if (bookingInterest) {
    metadataUpdates.bookingInterest = true;
  }

  if (bookingLinkSent) {
    metadataUpdates.bookingLinkSent = true;
    metadataUpdates.bookingLinkSentAt = new Date().toISOString();
  }

  if (bookingPushed) {
    const existingPushCount = existingMeta.bookingPushCount ?? 0;
    metadataUpdates.bookingPushCount = existingPushCount + 1;
  }

  // Verify booking push from actual message content — override if model misreported
  if (!bookingPushed && bookingLink && aiMessage.includes(bookingLink)) {
    // Model sent the booking link but reported bookingPushed: false
    // Load existing metadata if not already loaded
    if (!needsExistingMeta) {
      const conv = await db.query.conversation.findFirst({
        where: eq(conversation.id, conversationId),
      });
      existingMeta = (conv?.metadata as ConversationMetadata | null) ?? {};
    }
    const existingPushCount = existingMeta.bookingPushCount ?? 0;
    metadataUpdates.bookingPushCount = existingPushCount + 1;
    metadataUpdates.bookingLinkSent = true;
    metadataUpdates.bookingLinkSentAt = new Date().toISOString();
  }

  if (action === 'silent_handoff') {
    if (silentHandoffReason) {
      metadataUpdates.silentHandoffReason = silentHandoffReason;
    }
    if (ownerNotification) {
      metadataUpdates.ownerNotification = ownerNotification;
    }
  }

  if (action === 'handoff' && silentHandoffReason) {
    flowResult.escalationReasonDetail = silentHandoffReason;
  }

  // A real appointment was written this turn. Recorded on the conversation so
  // the follow-up, fallback and re-offer paths all agree that this lead has
  // booked — the same marker the deterministic slot flow sets.
  if (bookingCompleted) {
    metadataUpdates.directBookingConfirmedAt = new Date().toISOString();
    metadataUpdates.stage = 'booking';
    flowResult.bookingConfirmed = true;
  }

  if (needsFollowUp) {
    metadataUpdates.needsFollowUp = true;
    if (followUpReason) {
      metadataUpdates.followUpReason = followUpReason;
    }
  }

  metadataUpdates.lastBotResponseAt = new Date().toISOString();

  if (Object.keys(metadataUpdates).length > 0) {
    flowResult.metadataUpdates = metadataUpdates;
  }

  logger.info('AI result mapped to flow', {
    reason: 'ai_result_mapped',
    conversationId,
    debug: {
      action: aiResult.action ?? 'none',
      stoppedAt: flowResult.stoppedAt,
      messageCount: flowResult.messages.length,
      hasText: !!flowResult.messages[0]?.text?.trim(),
      messageLength: flowResult.messages[0]?.text?.length ?? 0,
      setAgentHandling: !!flowResult.setAgentHandling,
      metadataKeys: Object.keys(metadataUpdates),
    },
  });

  return flowResult;
}
