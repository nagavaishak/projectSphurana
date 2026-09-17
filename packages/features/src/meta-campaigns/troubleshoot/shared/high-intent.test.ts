import { describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import {
  HIGH_INTENT_STAGES,
  MIN_ENGAGED_USER_MESSAGES,
  SPEND_THRESHOLD_USD_CENTS,
  getHighIntentConversationStats,
  hasSpentEnough,
  isHighIntentConversation,
} from './high-intent.js';

describe('isHighIntentConversation', () => {
  it('is high-intent when stage is qualified', () => {
    expect(
      isHighIntentConversation({ stage: 'qualified', userMessageCount: 0 })
    ).toBe(true);
  });

  it('is high-intent when stage is booking', () => {
    expect(
      isHighIntentConversation({ stage: 'booking', userMessageCount: 1 })
    ).toBe(true);
  });

  it('is high-intent when bookingInterest is true even with an early stage', () => {
    expect(
      isHighIntentConversation({
        stage: 'first_contact',
        bookingInterest: true,
        userMessageCount: 1,
      })
    ).toBe(true);
  });

  it('is high-intent on multi-message engagement alone (>= threshold)', () => {
    expect(
      isHighIntentConversation({
        stage: 'enquiry',
        userMessageCount: MIN_ENGAGED_USER_MESSAGES,
      })
    ).toBe(true);
  });

  it('is NOT high-intent for an early stage, no booking interest, few messages', () => {
    expect(
      isHighIntentConversation({
        stage: 'first_contact',
        bookingInterest: false,
        userMessageCount: MIN_ENGAGED_USER_MESSAGES - 1,
      })
    ).toBe(false);
  });

  it('is NOT high-intent when stage is null/undefined and no other signal', () => {
    expect(isHighIntentConversation({ stage: null, userMessageCount: 0 })).toBe(
      false
    );
    expect(isHighIntentConversation({ userMessageCount: 1 })).toBe(false);
  });

  it('treats every HIGH_INTENT_STAGE as high-intent', () => {
    for (const stage of HIGH_INTENT_STAGES) {
      expect(isHighIntentConversation({ stage, userMessageCount: 0 })).toBe(
        true
      );
    }
  });
});

describe('hasSpentEnough', () => {
  it('is false below the €80 (USD-normalized) threshold', () => {
    expect(hasSpentEnough(SPEND_THRESHOLD_USD_CENTS - 1)).toBe(false);
  });
  it('is true at exactly the threshold', () => {
    expect(hasSpentEnough(SPEND_THRESHOLD_USD_CENTS)).toBe(true);
  });
  it('is true above the threshold', () => {
    expect(hasSpentEnough(SPEND_THRESHOLD_USD_CENTS + 5000)).toBe(true);
  });
});

// --- getHighIntentConversationStats with a mocked db -------------------------

interface MockAdRow {
  id: string;
  metaAdId: string | null;
}

function makeDb(opts: {
  adRows: MockAdRow[];
  conversationRows: unknown[];
}) {
  const where = vi.fn(async () => opts.adRows);
  const from = vi.fn(() => ({ where }));
  return {
    select: vi.fn(() => ({ from })),
    execute: vi.fn(async () => opts.conversationRows),
    _where: where,
    _from: from,
  };
}

describe('getHighIntentConversationStats', () => {
  it('returns zeros and never queries conversations when the campaign has no ads', async () => {
    const db = makeDb({ adRows: [], conversationRows: [] });

    const stats = await getHighIntentConversationStats(db as never, {
      organizationId: 'org-1',
      metaCampaignId: 'cmp-1',
    });

    expect(stats).toEqual({
      highIntentCount: 0,
      lastHighIntentAt: null,
      attributedConversations: 0,
    });
    // No conversation query is issued when there are no ad ids to match.
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('counts only high-intent conversations and tracks the latest activity', async () => {
    const older = new Date('2026-06-01T10:00:00.000Z');
    const newer = new Date('2026-06-04T10:00:00.000Z');
    const db = makeDb({
      adRows: [{ id: 'ad-internal-1', metaAdId: 'meta-ad-1' }],
      conversationRows: [
        // High-intent via stage, older.
        {
          id: 'c1',
          stage: 'qualified',
          bookingInterest: null,
          lastActivityAt: older.toISOString(),
          userMessageCount: 1,
        },
        // High-intent via bookingInterest, newer.
        {
          id: 'c2',
          stage: 'first_contact',
          bookingInterest: 'true',
          lastActivityAt: newer.toISOString(),
          userMessageCount: 1,
        },
        // Low-intent — should be ignored.
        {
          id: 'c3',
          stage: 'first_contact',
          bookingInterest: 'false',
          lastActivityAt: newer.toISOString(),
          userMessageCount: 1,
        },
      ],
    });

    const stats = await getHighIntentConversationStats(db as never, {
      organizationId: 'org-1',
      metaCampaignId: 'cmp-1',
    });

    expect(stats.highIntentCount).toBe(2);
    expect(stats.attributedConversations).toBe(3);
    expect(stats.lastHighIntentAt?.toISOString()).toBe(newer.toISOString());
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('coerces string-typed bigint message counts and applies the engagement arm', async () => {
    const db = makeDb({
      adRows: [{ id: 'ad-internal-1', metaAdId: null }],
      conversationRows: [
        {
          id: 'c1',
          stage: 'enquiry',
          bookingInterest: 'false',
          lastActivityAt: '2026-06-04T10:00:00.000Z',
          userMessageCount: '4', // string from postgres COUNT(*)
        },
      ],
    });

    const stats = await getHighIntentConversationStats(db as never, {
      organizationId: 'org-1',
      metaCampaignId: 'cmp-1',
    });

    expect(stats.highIntentCount).toBe(1);
  });
});
