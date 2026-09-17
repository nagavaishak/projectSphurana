import type { ConversationMessagePair } from '@borradh-workspace/integrations/meta-messaging';
import { describe, expect, it } from '@borradh-workspace/testing';
import { filterMessages } from './filter-messages.service.js';

/**
 * Regression coverage for `filterMessages` — the pure filter/dedup step that
 * prepares Meta conversation pairs for voice cloning.
 *
 * Bug families pinned:
 *  - Empty-state: `filterMessages([])` must return `[]`, never crash on the
 *    aggregate (no rows). (filter-messages.service.ts:28 loop / :66 slice)
 *  - Null/undefined deref on optional fields: real Meta payloads can omit
 *    `customerMessage` / `businessReply`, so the `?.trim()` guard at
 *    filter-messages.service.ts:30 must DROP such pairs rather than throw on
 *    `.length` / `.test()` of `undefined`.
 */

// A reply old enough to clear the 14-day recency cutoff and long enough to
// clear MIN_REPLY_LENGTH (20 chars).
const OLD = new Date('2020-01-01T00:00:00.000Z');
const LONG_REPLY = 'Thanks for reaching out, happy to help you book that in.';

const pair = (
  overrides: Partial<ConversationMessagePair>
): ConversationMessagePair => ({
  customerMessage: 'Do you have any availability this week?',
  businessReply: LONG_REPLY,
  timestamp: OLD,
  conversationId: 'conv-1',
  ...overrides,
});

describe('filterMessages', () => {
  it('returns an empty array for empty input (no crash on no data)', () => {
    expect(filterMessages([])).toEqual([]);
  });

  it('keeps a well-formed, old-enough, long-enough pair', () => {
    const result = filterMessages([pair({})]);
    expect(result).toHaveLength(1);
    expect(result[0].businessReply).toBe(LONG_REPLY);
  });

  it('drops pairs with a missing/undefined businessReply without throwing', () => {
    // Real Meta payloads can omit a field even though the type says string —
    // the `?.trim()` guard must drop the pair, not deref undefined.
    const bad = pair({ businessReply: undefined as unknown as string });
    expect(() => filterMessages([bad])).not.toThrow();
    expect(filterMessages([bad])).toEqual([]);
  });

  it('drops pairs with a missing/undefined customerMessage without throwing', () => {
    const bad = pair({ customerMessage: undefined as unknown as string });
    expect(() => filterMessages([bad])).not.toThrow();
    expect(filterMessages([bad])).toEqual([]);
  });

  it('drops pairs whose customer/business text is only whitespace', () => {
    expect(filterMessages([pair({ businessReply: '   ' })])).toEqual([]);
    expect(filterMessages([pair({ customerMessage: '  ' })])).toEqual([]);
  });

  it('drops replies shorter than the 20-char minimum', () => {
    expect(filterMessages([pair({ businessReply: 'Yes!' })])).toEqual([]);
  });

  it('drops URL-only replies even when long', () => {
    expect(
      filterMessages([
        pair({ businessReply: 'https://example.com/very/long/booking/link' }),
      ])
    ).toEqual([]);
  });

  it('deduplicates identical businessReply content', () => {
    const result = filterMessages([
      pair({ conversationId: 'a' }),
      pair({ conversationId: 'b' }),
    ]);
    expect(result).toHaveLength(1);
  });

  it('drops replies inside the 14-day recency cutoff', () => {
    const recent = pair({ timestamp: new Date() });
    expect(filterMessages([recent])).toEqual([]);
  });
});
