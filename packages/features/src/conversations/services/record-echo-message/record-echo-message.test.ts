import { drizzleUniqueViolation } from '@borradh-workspace/database';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import type { MockInstance } from 'vitest';
import { vi } from 'vitest';

// The queue helpers (Redis/BullMQ) and the tenant resolver are stubbed with
// RESTORED `vi.spyOn`s (see beforeEach/afterEach). `packages/features` runs
// `isolate: false`, so file-local `vi.mock` factories would persist on the
// shared worker module graph and leak into every later test file — and would
// silently miss entirely if an earlier file had already imported the real
// module.
import * as queueChatbotFlow from '../../../chatbots/services/queue-chatbot-flow/queue-chatbot-flow.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import * as resolveMessageContext from '../handle-incoming-message/resolve-message-context.js';
import { recordEchoMessage } from './record-echo-message.service.js';

// The service does:
// 1. resolveTenantContext(db, platform, pageId) -> { organizationId, ... }
// 2. db.query.conversation.findFirst (scoped by organizationId)
// 3. conversationMessage.findFirst  -> dedup existing by externalMessageId
// 4. conversationMessage.findFirst  -> localMatch (our own send, ±5s, null ext id)
// 5. conversationMessage.findFirst  -> lastInbound (most recent role='user'),
//    used to measure reply latency for auto-responder detection
const mockDb = {
  query: {
    conversation: { findFirst: vi.fn() },
    conversationMessage: { findFirst: vi.fn() },
  },
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  onConflictDoNothing: vi.fn().mockReturnThis(),
  returning: vi.fn(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue([]),
};

const validInput = {
  pageId: 'page-123',
  externalUserId: 'user-456',
  externalMessageId: 'mid-789',
  messageText: 'Sure, I can book you in for Tuesday at 3pm.',
  platform: 'facebook_messenger' as const,
  timestamp: 1700000000000,
};

const defaultContext = {
  organizationId: 'org-1',
  whatsappAccountId: null,
  metaAdsPageId: 'page-db-id',
  page: null,
  isChatbotActive: true,
};

/**
 * Queue the conversationMessage.findFirst results in call order:
 * existing (dedup) -> localMatch (our own send) -> lastInbound (most recent user).
 */
function queueMessageLookups(opts: {
  existing?: unknown;
  localMatch?: unknown;
  lastInbound?: unknown;
}) {
  mockDb.query.conversationMessage.findFirst
    .mockResolvedValueOnce(opts.existing ?? null)
    .mockResolvedValueOnce(opts.localMatch ?? null)
    .mockResolvedValueOnce(opts.lastInbound ?? null);
}

describe('recordEchoMessage', () => {
  let mockResolveTenantContext: MockInstance;
  let cancelPendingFlow: MockInstance;
  let spies: MockInstance[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    cancelPendingFlow = vi
      .spyOn(queueChatbotFlow, 'cancelPendingFlow')
      .mockResolvedValue(undefined);
    mockResolveTenantContext = vi.spyOn(
      resolveMessageContext,
      'resolveTenantContext'
    );
    spies = [
      cancelPendingFlow,
      mockResolveTenantContext,
      vi
        .spyOn(queueChatbotFlow, 'cancelResponseTimeout')
        .mockResolvedValue(undefined),
      vi
        .spyOn(queueChatbotFlow, 'cancelPendingMessageParts')
        .mockResolvedValue(undefined),
      vi
        .spyOn(queueChatbotFlow, 'cancelPendingFollowUp')
        .mockResolvedValue(undefined),
    ];
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.onConflictDoNothing.mockReturnThis();
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValue([]);
    mockResolveTenantContext.mockResolvedValue(defaultContext);
  });

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
  });

  it('records a human echo and flips a bot conversation to agent_handling', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      status: 'bot_handling',
      organizationId: 'org-1',
    });
    queueMessageLookups({
      // 10 minutes since the lead's last message → not instant → human.
      lastInbound: { sentAt: new Date(validInput.timestamp - 10 * 60 * 1000) },
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'msg-1' }]);

    const result = await recordEchoMessage(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ recorded: true, role: 'agent' });
    }
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'agent_handling' })
    );
    expect(cancelPendingFlow).toHaveBeenCalledWith('conv-1');
    // Human reply is not flagged as automation.
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'agent', metadata: undefined })
    );
  });

  it('keeps the bot in charge when the echo is an auto-responder', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      status: 'bot_handling',
      organizationId: 'org-1',
    });
    queueMessageLookups({
      // instant reply (800ms) after the lead's inbound.
      lastInbound: { sentAt: new Date(validInput.timestamp - 800) },
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'msg-1' }]);

    const result = await recordEchoMessage(mockDb as never, {
      ...validInput,
      messageText: 'Thanks for your message! We will get back to you shortly.',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ recorded: true, role: 'agent' });
    }
    // Crucially: NOT taken over, bot stays in charge.
    expect(mockDb.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'agent_handling' })
    );
    expect(cancelPendingFlow).not.toHaveBeenCalled();
    // Flagged as automation for the inbox.
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { autoResponder: true } })
    );
  });

  it('detects an auto-responder even when our bot already replied first', async () => {
    // The page's native auto-responder usually fires AFTER Claire's first reply,
    // so it is not the page's first outbound. Latency (not reply position) is
    // what identifies it — the old first-reply gate missed exactly this case.
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      status: 'bot_handling',
      organizationId: 'org-1',
    });
    queueMessageLookups({
      lastInbound: { sentAt: new Date(validInput.timestamp - 800) },
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'msg-1' }]);

    const result = await recordEchoMessage(mockDb as never, {
      ...validInput,
      messageText: 'Thanks for your message! We will get back to you shortly.',
    });

    expect(result.success).toBe(true);
    // Not taken over: recognised as automation despite not being the first reply.
    expect(mockDb.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'agent_handling' })
    );
    expect(cancelPendingFlow).not.toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { autoResponder: true } })
    );
  });

  it('takes over for a fast but trivial human ack (below the text threshold)', async () => {
    // An instant reply that is just "Yes!" is a human, not a canned auto-reply —
    // the word-char guard keeps it from being flagged as automation.
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      status: 'bot_handling',
      organizationId: 'org-1',
    });
    queueMessageLookups({
      lastInbound: { sentAt: new Date(validInput.timestamp - 800) },
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'msg-1' }]);

    const result = await recordEchoMessage(mockDb as never, {
      ...validInput,
      messageText: 'Yes!',
    });

    expect(result.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'agent_handling' })
    );
    expect(cancelPendingFlow).toHaveBeenCalledWith('conv-1');
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'agent', metadata: undefined })
    );
  });

  it('does not change status when an auto-responder fires on an already-agent conversation', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      status: 'agent_handling',
      organizationId: 'org-1',
    });
    queueMessageLookups({
      lastInbound: { sentAt: new Date(validInput.timestamp - 500) },
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'msg-1' }]);

    const result = await recordEchoMessage(mockDb as never, {
      ...validInput,
      messageText: 'Thanks for reaching out, our team will respond soon.',
    });

    expect(result.success).toBe(true);
    expect(cancelPendingFlow).not.toHaveBeenCalled();
  });

  it('backfills externalMessageId on our own send without classifying', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      status: 'bot_handling',
      organizationId: 'org-1',
    });
    // dedup -> none; localMatch -> our local bot message awaiting its ext id.
    mockDb.query.conversationMessage.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'local-1', role: 'bot' });

    const result = await recordEchoMessage(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ recorded: true, role: 'bot' });
    }
    // It's ours — never inserted as a new message, never taken over.
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(cancelPendingFlow).not.toHaveBeenCalled();
  });

  it('treats a concurrent backfill race (unique violation on the ext-id index) as already-recorded', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      status: 'bot_handling',
      organizationId: 'org-1',
    });
    mockDb.query.conversationMessage.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'local-1', role: 'bot' });
    mockDb.where.mockRejectedValueOnce(
      drizzleUniqueViolation('idx_conversation_message_ext_id')
    );

    const result = await recordEchoMessage(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ recorded: true, role: 'bot' });
    }
  });

  it('resolves tenant context first and scopes conversation lookup by org', async () => {
    mockResolveTenantContext.mockResolvedValueOnce({
      ...defaultContext,
      organizationId: 'org-expected',
    });
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(null);

    await recordEchoMessage(mockDb as never, validInput);

    expect(mockResolveTenantContext).toHaveBeenCalledWith(
      mockDb,
      validInput.platform,
      validInput.pageId
    );
    expect(mockDb.query.conversation.findFirst).toHaveBeenCalledTimes(1);
  });

  it('drops echo (recorded: false) when pageId has no tenant context', async () => {
    mockResolveTenantContext.mockResolvedValueOnce(null);

    const result = await recordEchoMessage(mockDb as never, {
      ...validInput,
      platform: 'whatsapp',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recorded).toBe(false);
    }
    expect(mockDb.query.conversation.findFirst).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns recorded: false when no conversation found in the resolved org', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(null);

    const result = await recordEchoMessage(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recorded).toBe(false);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns recorded: false when message already exists (deduplication)', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      status: 'bot_handling',
    });
    mockDb.query.conversationMessage.findFirst.mockResolvedValueOnce({
      id: 'msg-existing',
      externalMessageId: 'mid-789',
    });

    const result = await recordEchoMessage(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recorded).toBe(false);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('uses empty string for content when messageText is undefined', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      status: 'bot_handling',
      organizationId: 'org-1',
    });
    queueMessageLookups({});
    mockDb.returning.mockResolvedValueOnce([{ id: 'msg-1' }]);

    await recordEchoMessage(mockDb as never, {
      ...validInput,
      messageText: undefined,
    });

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ content: '' })
    );
  });

  it('works with whatsapp platform and flips status to agent_handling', async () => {
    mockResolveTenantContext.mockResolvedValueOnce({
      organizationId: 'org-wa',
      whatsappAccountId: 'wa-1',
      metaAdsPageId: null,
      page: null,
      isChatbotActive: true,
    });
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      status: 'bot_handling',
      organizationId: 'org-wa',
    });
    queueMessageLookups({
      lastInbound: { sentAt: new Date(validInput.timestamp - 10 * 60 * 1000) },
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'msg-1' }]);

    const result = await recordEchoMessage(mockDb as never, {
      ...validInput,
      platform: 'whatsapp',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ recorded: true, role: 'agent' });
    }
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'agent_handling' })
    );
  });

  it('returns VALIDATION_ERROR for missing pageId', async () => {
    const result = await recordEchoMessage(mockDb as never, {
      ...validInput,
      pageId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockResolveTenantContext).not.toHaveBeenCalled();
    expect(mockDb.query.conversation.findFirst).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing externalUserId', async () => {
    const result = await recordEchoMessage(mockDb as never, {
      ...validInput,
      externalUserId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for missing externalMessageId', async () => {
    const result = await recordEchoMessage(mockDb as never, {
      ...validInput,
      externalMessageId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for invalid platform', async () => {
    const result = await recordEchoMessage(mockDb as never, {
      ...validInput,
      platform: 'telegram' as never,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.query.conversation.findFirst.mockRejectedValueOnce(
      new Error('DB connection failed')
    );

    const result = await recordEchoMessage(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
