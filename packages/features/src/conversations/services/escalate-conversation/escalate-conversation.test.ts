import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as queueChatbotFlow from '../../../chatbots/services/queue-chatbot-flow/queue-chatbot-flow.service.js';
import * as recentNotification from '../../../notifications/services/_shared/recent-notification.js';
import * as dispatchNotificationModule from '../../../notifications/services/dispatch-notification/dispatch-notification.service.js';
import * as sharedAudit from '../../../shared/core/audit.js';
import * as notifyAgents from './notify-agents.js';

// The queue cancel helpers (Redis/BullMQ) and the agent notifier are stubbed
// with RESTORED `vi.spyOn`s (see beforeEach/afterEach below), not file-local
// `vi.mock` factories: this package runs `isolate: false`, so a factory would
// persist on the shared worker module graph and leak into every later file —
// and would silently miss if an earlier file had already imported the real
// module.

// NOTE: the conversation-event audit write is stubbed with a RESTORED
// `vi.spyOn` (see beforeEach/afterEach below), not `vi.mock`. `shared/index.js`
// has a fan-in of ~570 test files and this package runs `isolate: false`, so a
// file-local factory mock of that barrel would persist on the shared worker
// module graph and leak `logConversationEvent: vi.fn()` into every later file.

// No file-local factory mock of `drizzle-orm` — the real `eq` is used. Its
// return value only
// feeds `db.query.conversation.findFirst`'s where clause, which is mocked to
// resolve directly, so the operator's output is never inspected. A file-local
// factory mock of the aliased `drizzle-orm` would persist on the shared worker
// module graph under `isolate: false` and leak its overridden `eq` into every
// later test file.

import { ErrorCodes } from '../../../shared/index.js';
import { escalateConversation } from './escalate-conversation.service.js';

function createMockDb(conversation: Record<string, unknown> | null = null) {
  const mockValues = vi.fn().mockReturnThis();
  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
  const mockSet = vi.fn().mockReturnThis();
  const mockWhere = vi.fn().mockResolvedValue(undefined);
  const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockWhere });

  return {
    query: {
      conversation: {
        findFirst: vi.fn().mockResolvedValue(conversation),
      },
    },
    insert: mockInsert,
    update: mockUpdate,
    _mocks: { mockInsert, mockValues, mockUpdate, mockSet, mockWhere },
  };
}

describe('escalateConversation', () => {
  // Stub the conversation-event audit write so it doesn't count toward the
  // db.insert assertions (it's cross-cutting tracking, not escalation logic).
  let logConversationEventSpy: ReturnType<typeof vi.spyOn>;
  let mockCancelResponseTimeout: MockInstance;
  let mockCancelPendingMessageParts: MockInstance;
  let mockCancelPendingFollowUp: MockInstance;
  let mockCancelPendingFlow: MockInstance;
  let mockNotifyAgentsOfEscalation: MockInstance;
  let spies: MockInstance[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    logConversationEventSpy = vi
      .spyOn(sharedAudit, 'logConversationEvent')
      .mockResolvedValue(undefined) as ReturnType<typeof vi.spyOn>;
    mockCancelResponseTimeout = vi
      .spyOn(queueChatbotFlow, 'cancelResponseTimeout')
      .mockResolvedValue(undefined);
    mockCancelPendingMessageParts = vi
      .spyOn(queueChatbotFlow, 'cancelPendingMessageParts')
      .mockResolvedValue(undefined);
    mockCancelPendingFollowUp = vi
      .spyOn(queueChatbotFlow, 'cancelPendingFollowUp')
      .mockResolvedValue(undefined);
    mockCancelPendingFlow = vi
      .spyOn(queueChatbotFlow, 'cancelPendingFlow')
      .mockResolvedValue(undefined);
    mockNotifyAgentsOfEscalation = vi
      .spyOn(notifyAgents, 'notifyAgentsOfEscalation')
      .mockResolvedValue(undefined);
    spies = [
      mockCancelResponseTimeout,
      mockCancelPendingMessageParts,
      mockCancelPendingFollowUp,
      mockCancelPendingFlow,
      mockNotifyAgentsOfEscalation,
    ];
  });

  afterEach(() => {
    logConversationEventSpy.mockRestore();
    for (const spy of spies) spy.mockRestore();
  });

  it('successfully escalates a bot_handling conversation to agent_handling', async () => {
    const mockDb = createMockDb({
      id: 'conv-1',
      status: 'bot_handling',
      metadata: {},
    });

    const result = await escalateConversation(mockDb as never, {
      conversationId: 'conv-1',
      reason: 'user_requested_human',
      reasonDetail: 'Customer asked for a real person',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.escalated).toBe(true);
    }
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('returns escalated: false when conversation is already agent_handling', async () => {
    const mockDb = createMockDb({
      id: 'conv-1',
      status: 'agent_handling',
      metadata: {},
    });

    const result = await escalateConversation(mockDb as never, {
      conversationId: 'conv-1',
      reason: 'user_requested_human',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.escalated).toBe(false);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when conversation does not exist', async () => {
    const mockDb = createMockDb(null);

    const result = await escalateConversation(mockDb as never, {
      conversationId: 'conv-nonexistent',
      reason: 'user_requested_human',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('cancels all pending bot jobs', async () => {
    const mockDb = createMockDb({
      id: 'conv-1',
      status: 'bot_handling',
      metadata: {},
    });

    await escalateConversation(mockDb as never, {
      conversationId: 'conv-1',
      reason: 'ai_handoff',
    });

    expect(mockCancelResponseTimeout).toHaveBeenCalledWith('conv-1');
    expect(mockCancelPendingMessageParts).toHaveBeenCalledWith('conv-1');
    expect(mockCancelPendingFollowUp).toHaveBeenCalledWith('conv-1');
    expect(mockCancelPendingFlow).toHaveBeenCalledWith('conv-1');
  });

  it('inserts system message when insertSystemMessage is true', async () => {
    const mockDb = createMockDb({
      id: 'conv-1',
      status: 'bot_handling',
      metadata: {},
    });

    await escalateConversation(mockDb as never, {
      conversationId: 'conv-1',
      reason: 'user_requested_human',
      insertSystemMessage: true,
    });

    expect(mockDb._mocks.mockInsert).toHaveBeenCalled();
    expect(mockDb._mocks.mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        role: 'system',
        content: 'Conversation handed off to a team member.',
        messageType: 'text',
        origin: 'live',
      })
    );
  });

  it('does NOT insert system message when insertSystemMessage is false', async () => {
    const mockDb = createMockDb({
      id: 'conv-1',
      status: 'bot_handling',
      metadata: {},
    });

    await escalateConversation(mockDb as never, {
      conversationId: 'conv-1',
      reason: 'user_requested_human',
      insertSystemMessage: false,
    });

    expect(mockDb._mocks.mockInsert).not.toHaveBeenCalled();
  });

  it('calls notifyAgentsOfEscalation when notifyAgents is true', async () => {
    const mockDb = createMockDb({
      id: 'conv-1',
      status: 'bot_handling',
      metadata: {},
    });

    await escalateConversation(mockDb as never, {
      conversationId: 'conv-1',
      reason: 'user_requested_human',
      reasonDetail: 'User asked for human',
      notifyAgents: true,
    });

    expect(mockNotifyAgentsOfEscalation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        conversationId: 'conv-1',
        reason: 'user_requested_human',
        reasonDetail: 'User asked for human',
      })
    );
  });

  it('does NOT call notifyAgentsOfEscalation when notifyAgents is false', async () => {
    const mockDb = createMockDb({
      id: 'conv-1',
      status: 'bot_handling',
      metadata: {},
    });

    await escalateConversation(mockDb as never, {
      conversationId: 'conv-1',
      reason: 'user_requested_human',
      notifyAgents: false,
    });

    expect(mockNotifyAgentsOfEscalation).not.toHaveBeenCalled();
  });

  it('updates metadata with escalationReason, escalationDetail, escalatedAt', async () => {
    const mockDb = createMockDb({
      id: 'conv-1',
      status: 'bot_handling',
      metadata: { existingKey: 'existingValue' },
    });

    await escalateConversation(mockDb as never, {
      conversationId: 'conv-1',
      reason: 'user_requested_human',
      reasonDetail: 'Customer asked for a person',
    });

    expect(mockDb._mocks.mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'agent_handling',
        metadata: expect.objectContaining({
          existingKey: 'existingValue',
          escalationReason: 'user_requested_human',
          escalationDetail: 'Customer asked for a person',
          escalatedAt: expect.any(String),
        }),
      })
    );
  });

  it('returns VALIDATION_ERROR for invalid input', async () => {
    const mockDb = createMockDb();

    const result = await escalateConversation(mockDb as never, {
      conversationId: '',
      reason: 'user_requested_human',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for invalid reason', async () => {
    const mockDb = createMockDb();

    const result = await escalateConversation(mockDb as never, {
      conversationId: 'conv-1',
      reason: 'invalid_reason' as never,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  // A lead that messages in and is escalated in the same breath is ONE
  // arrival. It already produced a `lead_created` ping, so the handoff must
  // not fire a second one.
  describe('handoff notification dedup', () => {
    let mockHasRecent: MockInstance;
    let mockDispatch: MockInstance;

    beforeEach(() => {
      mockHasRecent = vi.spyOn(recentNotification, 'hasRecentNotification');
      mockDispatch = vi
        .spyOn(dispatchNotificationModule, 'dispatchNotification')
        .mockResolvedValue({ success: true, data: { recipientCount: 1 } });
      spies.push(mockHasRecent, mockDispatch);
    });

    const escalate = async () => {
      const mockDb = createMockDb({
        id: 'conv-1',
        organizationId: 'org-1',
        status: 'bot_handling',
        metadata: {},
      });
      await escalateConversation(mockDb as never, {
        conversationId: 'conv-1',
        reason: 'user_requested_human',
      });
      // The dispatch is deliberately fire-and-forget — let it settle.
      await new Promise((resolve) => setImmediate(resolve));
    };

    it('suppresses the handoff when the lead was just notified', async () => {
      mockHasRecent.mockResolvedValue(true);

      await escalate();

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('still notifies a handoff in an existing conversation', async () => {
      mockHasRecent.mockResolvedValue(false);

      await escalate();

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'chatbot_handoff' })
      );
    });

    it('notifies rather than drops when the dedup lookup fails', async () => {
      // Degrading to a duplicate ping is acceptable; silently dropping the
      // "conversation needs you" alert is not.
      mockHasRecent.mockRejectedValue(new Error('db down'));

      await escalate();

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'chatbot_handoff' })
      );
    });
  });
});
