import { describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { inspectConversationIntent } from './inspect-conversation-intent.service.js';

function makeDb(opts: {
  conversation?: Record<string, unknown>;
  userMessageCount?: number;
}) {
  return {
    query: {
      conversation: {
        findFirst: vi.fn().mockResolvedValue(opts.conversation),
      },
    },
    execute: vi.fn().mockResolvedValue([{ count: opts.userMessageCount ?? 0 }]),
  };
}

describe('inspectConversationIntent', () => {
  it('reports CTWA attribution and a high-intent verdict with reasons', async () => {
    const db = makeDb({
      conversation: {
        id: 'conv-1',
        organizationId: 'org-1',
        platform: 'whatsapp',
        externalUserId: '353871234567',
        externalUserName: 'Jane',
        metadata: {
          adMetaId: 'meta-ad-9',
          adInternalId: 'ad-internal-9',
          adTitle: 'Summer facial offer',
          stage: 'qualified',
          bookingInterest: false,
        },
      },
      userMessageCount: 2,
    });

    const result = await inspectConversationIntent(db as never, {
      conversationId: 'conv-1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const r = result.data;
    expect(r.attribution).toEqual({
      adMetaId: 'meta-ad-9',
      adInternalId: 'ad-internal-9',
      adTitle: 'Summer facial offer',
      attributed: true,
    });
    expect(r.isHighIntent).toBe(true);
    expect(r.reasons).toContain('stage is "qualified"');
    expect(r.userMessageCount).toBe(2);
  });

  it('reports an unattributed, low-intent conversation', async () => {
    const db = makeDb({
      conversation: {
        id: 'conv-2',
        organizationId: 'org-1',
        platform: 'whatsapp',
        externalUserId: '353870000000',
        externalUserName: null,
        metadata: { stage: 'first_contact', bookingInterest: false },
      },
      userMessageCount: 1,
    });

    const result = await inspectConversationIntent(db as never, {
      conversationId: 'conv-2',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.attribution.attributed).toBe(false);
    expect(result.data.isHighIntent).toBe(false);
    expect(result.data.reasons).toEqual([]);
  });

  it('looks up by org + platform + externalUserId', async () => {
    const db = makeDb({
      conversation: {
        id: 'conv-3',
        organizationId: 'org-1',
        platform: 'whatsapp',
        externalUserId: '353871111111',
        externalUserName: null,
        metadata: { bookingInterest: true },
      },
      userMessageCount: 0,
    });

    const result = await inspectConversationIntent(db as never, {
      organizationId: 'org-1',
      platform: 'whatsapp',
      externalUserId: '353871111111',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.isHighIntent).toBe(true);
    expect(result.data.reasons).toContain('bookingInterest is true');
  });

  it('returns NOT_FOUND when no conversation matches', async () => {
    const db = makeDb({ conversation: undefined });
    const result = await inspectConversationIntent(db as never, {
      conversationId: 'missing',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR when no usable identifier is supplied', async () => {
    const db = makeDb({});
    const result = await inspectConversationIntent(db as never, {
      organizationId: 'org-1', // missing platform + externalUserId
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(db.query.conversation.findFirst).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR when the lookup throws', async () => {
    const db = makeDb({});
    db.query.conversation.findFirst.mockRejectedValueOnce(new Error('boom'));
    const result = await inspectConversationIntent(db as never, {
      conversationId: 'conv-x',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
