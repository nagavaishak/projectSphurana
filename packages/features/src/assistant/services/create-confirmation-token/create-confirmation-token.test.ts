import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { createConfirmationToken } from './create-confirmation-token.service.js';

const mockDb = {
  insert: vi.fn(),
  values: vi.fn(),
  returning: vi.fn(),
  query: {
    assistantMessage: {
      findFirst: vi.fn(),
    },
  },
};

const validInput = {
  organizationId: 'org-1',
  conversationId: 'conv-1',
  action: 'launch_ad' as const,
  resourceId: 'ad-1',
};

describe('createConfirmationToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue(mockDb);
    mockDb.values.mockReturnValue(mockDb);
    // Turn-boundary anchor lookup: default to a prior user message so the
    // token records a `createdInMessageId`.
    mockDb.query.assistantMessage.findFirst.mockResolvedValue({
      id: 'user-msg-before',
    });
  });

  it('inserts a token and returns id + expiresAt', async () => {
    const expiresAt = new Date('2026-01-01T00:30:00Z');
    mockDb.returning.mockResolvedValueOnce([{ id: 'token-abc', expiresAt }]);

    const result = await createConfirmationToken(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('token-abc');
      expect(result.data.expiresAt).toEqual(expiresAt);
    }
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('uses default 30-minute TTL when none provided', async () => {
    const before = Date.now();
    mockDb.returning.mockResolvedValueOnce([
      { id: 'token-abc', expiresAt: new Date(before + 30 * 60_000) },
    ]);

    await createConfirmationToken(mockDb as never, validInput);

    const insertedValues = mockDb.values.mock.calls[0]?.[0] as
      | { expiresAt: Date }
      | undefined;
    expect(insertedValues).toBeDefined();
    if (insertedValues) {
      const diffMin = (insertedValues.expiresAt.getTime() - before) / 60_000;
      expect(diffMin).toBeGreaterThanOrEqual(29);
      expect(diffMin).toBeLessThanOrEqual(31);
    }
  });

  it('honours ttlMinutes override', async () => {
    const before = Date.now();
    mockDb.returning.mockResolvedValueOnce([
      { id: 'token-abc', expiresAt: new Date(before + 5 * 60_000) },
    ]);

    await createConfirmationToken(mockDb as never, {
      ...validInput,
      ttlMinutes: 5,
    });

    const insertedValues = mockDb.values.mock.calls[0]?.[0] as
      | { expiresAt: Date }
      | undefined;
    expect(insertedValues).toBeDefined();
    if (insertedValues) {
      const diffMin = (insertedValues.expiresAt.getTime() - before) / 60_000;
      expect(diffMin).toBeGreaterThanOrEqual(4);
      expect(diffMin).toBeLessThanOrEqual(6);
    }
  });

  it('passes payload through to the row', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 'token-abc', expiresAt: new Date() },
    ]);

    const payload = { newBudgetCents: 5000 };
    await createConfirmationToken(mockDb as never, {
      ...validInput,
      payload,
    });

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ payload })
    );
  });

  it('stamps createdInMessageId with the latest persisted user message (turn-boundary anchor)', async () => {
    mockDb.query.assistantMessage.findFirst.mockResolvedValueOnce({
      id: 'user-msg-42',
    });
    mockDb.returning.mockResolvedValueOnce([
      { id: 'token-abc', expiresAt: new Date() },
    ]);

    await createConfirmationToken(mockDb as never, validInput);

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ createdInMessageId: 'user-msg-42' })
    );
  });

  it('stamps createdInMessageId null on a conversation first turn (no prior user message)', async () => {
    mockDb.query.assistantMessage.findFirst.mockResolvedValueOnce(undefined);
    mockDb.returning.mockResolvedValueOnce([
      { id: 'token-abc', expiresAt: new Date() },
    ]);

    await createConfirmationToken(mockDb as never, validInput);

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ createdInMessageId: null })
    );
  });

  it('returns VALIDATION_ERROR for missing conversationId', async () => {
    const result = await createConfirmationToken(mockDb as never, {
      ...validInput,
      conversationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for unknown action', async () => {
    const result = await createConfirmationToken(mockDb as never, {
      ...validInput,
      action: 'not_a_real_action' as never,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await createConfirmationToken(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
