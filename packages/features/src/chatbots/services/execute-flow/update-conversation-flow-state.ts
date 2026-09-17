import { conversation } from '@borradh-workspace/database';
import { trackOrgEvent } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';

interface UpdateConversationFlowStateInput {
  conversationId: string;
  currentNodeId: string | null;
  setAgentHandling?: boolean;
  metadataUpdates?: Record<string, unknown>;
  /** Labels the handoff trigger in the conversation_handed_off event. */
  handoffSource?: string;
}

/**
 * Update conversation state after a flow execution step.
 * Merges metadata updates with existing metadata.
 */
export async function updateConversationFlowState(
  db: DbConnection,
  input: UpdateConversationFlowStateInput
): Promise<void> {
  const {
    conversationId,
    currentNodeId,
    setAgentHandling,
    metadataUpdates,
    handoffSource,
  } = input;

  const updateData: Record<string, unknown> = {
    currentNodeId,
  };

  // Load the current row when we need to merge metadata OR to detect a real
  // bot→human transition (so the handoff event fires once, not on every step
  // that happens to pass setAgentHandling).
  const hasMetadataUpdates =
    !!metadataUpdates && Object.keys(metadataUpdates).length > 0;
  const conv =
    setAgentHandling || hasMetadataUpdates
      ? await db.query.conversation.findFirst({
          where: eq(conversation.id, conversationId),
        })
      : null;

  if (setAgentHandling) {
    updateData.status = 'agent_handling';
  }

  if (hasMetadataUpdates) {
    const existingMetadata = (conv?.metadata as Record<string, unknown>) ?? {};
    updateData.metadata = { ...existingMetadata, ...metadataUpdates };
  }

  await db
    .update(conversation)
    .set(updateData)
    .where(eq(conversation.id, conversationId));

  // Product analytics: emit once on the real transition into agent handling
  // (the AI silent_handoff / handoff paths). conversation_created is the
  // denominator for the handoff-rate metric.
  if (setAgentHandling && conv && conv.status !== 'agent_handling') {
    trackOrgEvent(conv.organizationId, 'conversation_handed_off', {
      organizationId: conv.organizationId,
      conversationId,
      source: handoffSource ?? 'chatbot_flow',
    });
  }
}
