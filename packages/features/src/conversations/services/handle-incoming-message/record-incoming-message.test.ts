import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { recordIncomingMessage } from './record-incoming-message.js';

const mockDb = {
  query: {
    conversationMessage: { findFirst: vi.fn() },
  },
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  onConflictDoNothing: vi.fn().mockReturnThis(),
  returning: vi.fn(),
};

describe('recordIncomingMessage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts new message with origin live', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 'msg-1', content: 'Hello', role: 'user' },
    ]);

    const result = await recordIncomingMessage(mockDb as never, {
      conversationId: 'conv-1',
      externalMessageId: 'ext-msg-1',
      content: 'Hello',
    });

    expect(result.id).toBe('msg-1');
    expect(result.alreadyExists).toBe(false);
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'live' })
    );
    expect(mockDb.onConflictDoNothing).toHaveBeenCalled();
  });

  it('returns alreadyExists when externalMessageId already recorded', async () => {
    mockDb.query.conversationMessage.findFirst.mockResolvedValueOnce({
      id: 'existing-msg-1',
      content: 'Hello',
    });

    const result = await recordIncomingMessage(mockDb as never, {
      conversationId: 'conv-1',
      externalMessageId: 'ext-msg-1',
      content: 'Hello',
    });

    expect(result.id).toBe('existing-msg-1');
    expect(result.alreadyExists).toBe(true);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('always checks for duplicates when externalMessageId present', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 'msg-1', content: 'Hello', role: 'user' },
    ]);

    await recordIncomingMessage(mockDb as never, {
      conversationId: 'conv-1',
      externalMessageId: 'ext-msg-1',
      content: 'Hello',
    });

    expect(mockDb.query.conversationMessage.findFirst).toHaveBeenCalled();
  });

  it('rejects empty content silently', async () => {
    const result = await recordIncomingMessage(mockDb as never, {
      conversationId: 'conv-1',
      content: '',
    });

    expect(result.alreadyExists).toBe(true);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only content silently', async () => {
    const result = await recordIncomingMessage(mockDb as never, {
      conversationId: 'conv-1',
      content: '   ',
    });

    expect(result.alreadyExists).toBe(true);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('defaults messageType to text and metadata to null', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 'msg-1', content: 'Hello', role: 'user' },
    ]);

    await recordIncomingMessage(mockDb as never, {
      conversationId: 'conv-1',
      content: 'Hello',
    });

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ messageType: 'text', metadata: null })
    );
  });

  it('persists messageType and metadata for a non-text (sticker) message', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 'msg-2', content: '👍', role: 'user' },
    ]);

    await recordIncomingMessage(mockDb as never, {
      conversationId: 'conv-1',
      externalMessageId: 'ext-2',
      content: '👍',
      messageType: 'attachment',
      metadata: { stickerId: '369239263222822', isLike: true },
    });

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '👍',
        messageType: 'attachment',
        metadata: { stickerId: '369239263222822', isLike: true },
      })
    );
  });

  it('uses provided timestamp', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 'msg-1', content: 'Hi', role: 'user' },
    ]);

    await recordIncomingMessage(mockDb as never, {
      conversationId: 'conv-1',
      content: 'Hi',
      timestamp: 1704067200000,
    });

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        sentAt: new Date(1704067200000),
      })
    );
  });

  it('uses current time when no timestamp provided', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 'msg-1', content: 'Hi', role: 'user' },
    ]);

    const before = Date.now();
    await recordIncomingMessage(mockDb as never, {
      conversationId: 'conv-1',
      content: 'Hi',
    });
    const after = Date.now();

    const sentAt = mockDb.values.mock.calls[0][0].sentAt as Date;
    expect(sentAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(sentAt.getTime()).toBeLessThanOrEqual(after);
  });

  it('skips dedup when no externalMessageId', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 'msg-1', content: 'Hi', role: 'user' },
    ]);

    await recordIncomingMessage(mockDb as never, {
      conversationId: 'conv-1',
      content: 'Hi',
    });

    expect(mockDb.query.conversationMessage.findFirst).not.toHaveBeenCalled();
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('handles onConflictDoNothing (returns empty array)', async () => {
    mockDb.query.conversationMessage.findFirst
      .mockResolvedValueOnce(null) // dedup check
      .mockResolvedValueOnce({ id: 'existing-msg' }); // fallback lookup
    mockDb.returning.mockResolvedValueOnce([]); // conflict, no rows returned

    const result = await recordIncomingMessage(mockDb as never, {
      conversationId: 'conv-1',
      externalMessageId: 'ext-msg-1',
      content: 'Hello',
    });

    expect(result.alreadyExists).toBe(true);
    expect(result.id).toBe('existing-msg');
  });
});
