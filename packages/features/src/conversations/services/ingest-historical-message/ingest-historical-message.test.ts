import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import * as resolveMessageContextModule from '../handle-incoming-message/resolve-message-context.js';
import { ingestHistoricalMessage } from './ingest-historical-message.service.js';

// The tenant resolver — ingestHistoricalMessage uses it to scope lookups by
// organizationId and read `isChatbotActive` — is stubbed with a restored
// `vi.spyOn`, NOT `vi.mock`. `packages/features` runs `isolate: false`, so a
// hoisted bare factory both persists on the shared module graph (deleting every
// other export of resolve-message-context for later files) and silently misses
// whenever an earlier file already imported the real module.
let mockResolveTenantContext: MockInstance;

const mockDb = {
  query: {
    conversation: { findFirst: vi.fn() },
    organization: { findFirst: vi.fn() },
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
  pageId: 'phone-1',
  externalUserId: '15551234567',
  externalMessageId: 'wamid.HBgL...',
  messageText: 'Hello from the past',
  role: 'user' as const,
  timestamp: 1_700_000_000_000,
  platform: 'whatsapp' as const,
};

const defaultContext = {
  organizationId: 'org-1',
  whatsappAccountId: 'wa-1',
  metaAdsPageId: null,
  page: null,
  isChatbotActive: false,
};

describe('ingestHistoricalMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.onConflictDoNothing.mockReturnThis();
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValue([]);
    mockResolveTenantContext = vi
      .spyOn(resolveMessageContextModule, 'resolveTenantContext')
      .mockResolvedValue(defaultContext as never);
  });

  afterEach(() => {
    mockResolveTenantContext.mockRestore();
  });

  it('creates a new conversation with agent_handling when chatbot inactive', async () => {
    // chatbot inactive (default context) → always agent_handling
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(null);
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'conv-1', lastMessageAt: null }])
      .mockResolvedValueOnce([{ id: 'msg-1' }]);

    const result = await ingestHistoricalMessage(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'agent_handling',
        platform: 'whatsapp',
      })
    );
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'backfill', role: 'user' })
    );
  });

  it('seeds bot_handling when the chatbot is active', async () => {
    // Targeting (newLeadsOnly) was removed — an active chatbot always seeds
    // bot_handling, and Claire classifies each inbound from there.
    mockResolveTenantContext.mockResolvedValueOnce({
      ...defaultContext,
      isChatbotActive: true,
    });
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(null);
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'conv-1', lastMessageAt: null }])
      .mockResolvedValueOnce([{ id: 'msg-1' }]);

    await ingestHistoricalMessage(mockDb as never, validInput);

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'bot_handling' })
    );
  });

  it('reuses existing conversation without changing its status', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-existing',
      lastMessageAt: new Date(1_500_000_000_000),
      status: 'bot_handling',
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'msg-2' }]);

    const result = await ingestHistoricalMessage(mockDb as never, validInput);

    expect(result.success).toBe(true);
    // No conversation insert — first insert call is the message
    expect(mockDb.values).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'agent_handling' })
    );
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-existing',
        origin: 'backfill',
      })
    );
  });

  it('is idempotent on duplicate externalMessageId', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      lastMessageAt: new Date(1_800_000_000_000),
    });
    // Conflict — insert returns empty
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await ingestHistoricalMessage(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(false);
      expect(result.data.messageId).toBeNull();
      expect(result.data.conversationId).toBe('conv-1');
    }
  });

  it('returns NOT_FOUND when resolver finds no tenant for phone_number_id', async () => {
    mockResolveTenantContext.mockResolvedValueOnce(null);

    const result = await ingestHistoricalMessage(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns NOT_FOUND when resolver returns context without whatsappAccountId', async () => {
    // Defensive: the resolver should never return a non-whatsapp context for
    // a whatsapp pageId, but we don't want to silently write into the wrong
    // account if it somehow does.
    mockResolveTenantContext.mockResolvedValueOnce({
      ...defaultContext,
      whatsappAccountId: null,
    });

    const result = await ingestHistoricalMessage(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns VALIDATION_ERROR for non-whatsapp platform', async () => {
    const result = await ingestHistoricalMessage(mockDb as never, {
      ...validInput,
      platform: 'facebook_messenger' as never,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for invalid role', async () => {
    const result = await ingestHistoricalMessage(mockDb as never, {
      ...validInput,
      role: 'bot' as never,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockResolveTenantContext.mockRejectedValueOnce(
      new Error('DB connection failed')
    );

    const result = await ingestHistoricalMessage(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
