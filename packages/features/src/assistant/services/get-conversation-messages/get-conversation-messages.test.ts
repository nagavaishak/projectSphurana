import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

// `@borradh-workspace/database`, `@borradh-workspace/observability` and
// `drizzle-orm` are aliased to canonical shared mocks in vite.config.ts — never
// vi.mock them here (a file-local mock leaks across files under `isolate:false`).
// The canonical database mock provides `withOrgScope` as a passthrough and the
// real `assistantMessage` table object; observability's `trackedResult` is a
// passthrough and `logError` a vi.fn(); real drizzle operators are used.

import { ErrorCodes } from '../../../shared/index.js';
import { getConversationMessages } from './get-conversation-messages.service.js';

const mockDb = {
  query: {
    assistantMessage: { findMany: vi.fn() },
  },
};

const validInput = {
  conversationId: 'conv-1',
  organizationId: 'org-1',
};

describe('getConversationMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the most-recent rows reversed into chronological order', async () => {
    // findMany returns DESC (newest first); the service reverses to ASC.
    mockDb.query.assistantMessage.findMany.mockResolvedValueOnce([
      { id: 'msg-2', role: 'assistant', content: 'Hi', createdAt: new Date(2) },
      { id: 'msg-1', role: 'user', content: 'Hello', createdAt: new Date(1) },
    ]);

    const result = await getConversationMessages(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.map((m) => m.id)).toEqual(['msg-1', 'msg-2']);
      expect(result.data[0].role).toBe('user');
    }
  });

  it('passes the window limit to findMany', async () => {
    mockDb.query.assistantMessage.findMany.mockResolvedValueOnce([]);

    await getConversationMessages(mockDb as never, {
      ...validInput,
      limit: 10,
    });

    expect(mockDb.query.assistantMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 })
    );
  });

  it('defaults the window limit when not provided', async () => {
    mockDb.query.assistantMessage.findMany.mockResolvedValueOnce([]);

    await getConversationMessages(mockDb as never, validInput);

    expect(mockDb.query.assistantMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 60 })
    );
  });

  it('returns an empty array when there are no messages', async () => {
    mockDb.query.assistantMessage.findMany.mockResolvedValueOnce([]);

    const result = await getConversationMessages(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(0);
    }
  });

  it('returns VALIDATION_ERROR for missing conversationId', async () => {
    const result = await getConversationMessages(mockDb as never, {
      conversationId: '',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.query.assistantMessage.findMany).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR when the query throws', async () => {
    mockDb.query.assistantMessage.findMany.mockRejectedValueOnce(
      new Error('DB failed')
    );

    const result = await getConversationMessages(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
