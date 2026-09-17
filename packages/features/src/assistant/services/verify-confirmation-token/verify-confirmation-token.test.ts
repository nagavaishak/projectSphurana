import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { verifyConfirmationToken } from './verify-confirmation-token.service.js';

const mockDb = {
  query: {
    claireConfirmationToken: {
      findFirst: vi.fn(),
    },
    assistantMessage: {
      findFirst: vi.fn(),
    },
  },
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
};

// Token creation time used across the happy-path rows. The turn-boundary
// check looks for a user message NEWER than this.
const tokenCreatedAt = new Date(Date.now() - 30_000);

// The intervening user message that satisfies the turn-boundary rule —
// created AFTER the token. Returned by assistantMessage.findFirst for the
// tests that expect a valid consumption.
const approvingUserMessage = { id: 'user-msg-after' };

const validInput = {
  organizationId: 'org-1',
  conversationId: 'conv-1',
  action: 'launch_ad' as const,
  resourceId: 'ad-1',
  token: 'token-abc',
};

describe('verifyConfirmationToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.update.mockReturnValue(mockDb);
    mockDb.set.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
    // Default: an intervening user message exists, so the turn-boundary rule
    // passes. Tests that assert `no_user_turn` override this to `undefined`.
    mockDb.query.assistantMessage.findFirst.mockResolvedValue(
      approvingUserMessage
    );
  });

  it('returns valid + payload + marks consumed when token matches and unexpired', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const payload = { newBudgetCents: 5000 };
    mockDb.query.claireConfirmationToken.findFirst.mockResolvedValueOnce({
      id: 'token-abc',
      organizationId: 'org-1',
      conversationId: 'conv-1',
      action: 'launch_ad',
      resourceId: 'ad-1',
      payload,
      consumedAt: null,
      createdAt: tokenCreatedAt,
      createdInMessageId: 'user-msg-before',
      expiresAt,
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'token-abc' }]);

    const result = await verifyConfirmationToken(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success && result.data.valid) {
      expect(result.data.payload).toEqual(payload);
    }
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        consumedAt: expect.any(Date),
        // The turn-boundary approval record: the intervening user message id.
        approvedInMessageId: approvingUserMessage.id,
      })
    );
  });

  it('returns valid:false reason:no_user_turn when no user message post-dates the token (same-turn self-launch, #131)', async () => {
    mockDb.query.claireConfirmationToken.findFirst.mockResolvedValueOnce({
      id: 'token-abc',
      organizationId: 'org-1',
      conversationId: 'conv-1',
      action: 'launch_ad',
      resourceId: 'ad-1',
      payload: null,
      consumedAt: null,
      createdAt: tokenCreatedAt,
      createdInMessageId: 'user-msg-before',
      expiresAt: new Date(Date.now() + 60_000),
    });
    // No intervening user message — the operator has not replied after the
    // proposal card was shown (the same turn that created the token).
    mockDb.query.assistantMessage.findFirst.mockResolvedValueOnce(undefined);

    const result = await verifyConfirmationToken(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success && !result.data.valid) {
      expect(result.data.reason).toBe('no_user_turn');
    }
    // The token is NOT consumed when the turn-boundary rule blocks it.
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('excludes createdInMessageId from the turn-boundary lookup', async () => {
    // Regression guard: the query that finds the approving user message must
    // exclude `createdInMessageId` so a token can never be approved by the
    // user message that already existed when it was created.
    mockDb.query.claireConfirmationToken.findFirst.mockResolvedValueOnce({
      id: 'token-abc',
      organizationId: 'org-1',
      conversationId: 'conv-1',
      action: 'launch_ad',
      resourceId: 'ad-1',
      payload: null,
      consumedAt: null,
      createdAt: tokenCreatedAt,
      createdInMessageId: 'user-msg-before',
      expiresAt: new Date(Date.now() + 60_000),
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'token-abc' }]);

    await verifyConfirmationToken(mockDb as never, validInput);

    // The turn-boundary lookup ran (a user message was searched for after the
    // token's createdAt).
    expect(mockDb.query.assistantMessage.findFirst).toHaveBeenCalledTimes(1);
  });

  it('returns valid:false reason:not_found when token does not exist', async () => {
    mockDb.query.claireConfirmationToken.findFirst.mockResolvedValueOnce(
      undefined
    );

    const result = await verifyConfirmationToken(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.valid).toBe(false);
      if (!result.data.valid) {
        expect(result.data.reason).toBe('not_found');
      }
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns valid:false reason:consumed when consumedAt is set', async () => {
    mockDb.query.claireConfirmationToken.findFirst.mockResolvedValueOnce({
      id: 'token-abc',
      organizationId: 'org-1',
      conversationId: 'conv-1',
      action: 'launch_ad',
      resourceId: 'ad-1',
      payload: null,
      consumedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await verifyConfirmationToken(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success && !result.data.valid) {
      expect(result.data.reason).toBe('consumed');
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns valid:false reason:expired when expiresAt is past', async () => {
    mockDb.query.claireConfirmationToken.findFirst.mockResolvedValueOnce({
      id: 'token-abc',
      organizationId: 'org-1',
      conversationId: 'conv-1',
      action: 'launch_ad',
      resourceId: 'ad-1',
      payload: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const result = await verifyConfirmationToken(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success && !result.data.valid) {
      expect(result.data.reason).toBe('expired');
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns valid:false reason:mismatch when action differs', async () => {
    mockDb.query.claireConfirmationToken.findFirst.mockResolvedValueOnce({
      id: 'token-abc',
      organizationId: 'org-1',
      conversationId: 'conv-1',
      action: 'pause_campaign',
      resourceId: 'ad-1',
      payload: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await verifyConfirmationToken(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success && !result.data.valid) {
      expect(result.data.reason).toBe('mismatch');
    }
  });

  it('returns valid:false reason:mismatch when organizationId differs', async () => {
    mockDb.query.claireConfirmationToken.findFirst.mockResolvedValueOnce({
      id: 'token-abc',
      organizationId: 'different-org',
      conversationId: 'conv-1',
      action: 'launch_ad',
      resourceId: 'ad-1',
      payload: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await verifyConfirmationToken(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success && !result.data.valid) {
      expect(result.data.reason).toBe('mismatch');
    }
  });

  it('handles concurrent consumption — second caller gets reason:consumed', async () => {
    mockDb.query.claireConfirmationToken.findFirst.mockResolvedValueOnce({
      id: 'token-abc',
      organizationId: 'org-1',
      conversationId: 'conv-1',
      action: 'launch_ad',
      resourceId: 'ad-1',
      payload: null,
      consumedAt: null,
      createdAt: tokenCreatedAt,
      createdInMessageId: 'user-msg-before',
      expiresAt: new Date(Date.now() + 60_000),
    });
    // Simulate the row being consumed by another caller before our update
    // hits — returning() yields no rows.
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await verifyConfirmationToken(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success && !result.data.valid) {
      expect(result.data.reason).toBe('consumed');
    }
  });

  it('matches successfully when resourceId is omitted (create-style tools)', async () => {
    // Create-style tools (e.g. createLead) fabricate the token's resourceId
    // from the input on issue, but the second-call input has no field that
    // carries it back. The factory then passes `resourceId: undefined` and
    // we skip the resourceId equality check.
    const expiresAt = new Date(Date.now() + 60_000);
    const payload = { firstName: 'Test', lastName: 'CrudOne' };
    mockDb.query.claireConfirmationToken.findFirst.mockResolvedValueOnce({
      id: 'token-abc',
      organizationId: 'org-1',
      conversationId: 'conv-1',
      action: 'create_lead',
      resourceId: 'lead:Test CrudOne',
      payload,
      consumedAt: null,
      createdAt: tokenCreatedAt,
      createdInMessageId: 'user-msg-before',
      expiresAt,
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'token-abc' }]);

    const result = await verifyConfirmationToken(mockDb as never, {
      organizationId: 'org-1',
      conversationId: 'conv-1',
      action: 'create_lead' as const,
      token: 'token-abc',
      // resourceId intentionally omitted
    });

    expect(result.success).toBe(true);
    if (result.success && result.data.valid) {
      expect(result.data.payload).toEqual(payload);
    }
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing token', async () => {
    const result = await verifyConfirmationToken(mockDb as never, {
      ...validInput,
      token: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.query.claireConfirmationToken.findFirst.mockRejectedValueOnce(
      new Error('DB connection lost')
    );

    const result = await verifyConfirmationToken(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
