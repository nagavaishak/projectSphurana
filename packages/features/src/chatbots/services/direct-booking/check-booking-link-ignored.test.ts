import type { DbConnection } from '@borradh-workspace/database';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { checkBookingLinkIgnored } from './check-booking-link-ignored.js';
import { DEFAULT_BOOKING_FALLBACK_TIMEOUT_MS } from './direct-booking.schema.js';

const mockDb = {
  query: {
    organization: { findFirst: vi.fn() },
    conversation: { findFirst: vi.fn() },
  },
};

// A timestamp comfortably older than the default fallback timeout.
const elapsedLinkSentAt = () =>
  new Date(
    Date.now() - DEFAULT_BOOKING_FALLBACK_TIMEOUT_MS - 60_000
  ).toISOString();

const run = () =>
  checkBookingLinkIgnored(mockDb as unknown as DbConnection, {
    conversationId: 'conv-1',
    organizationId: 'org-1',
  });

describe('checkBookingLinkIgnored', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers direct booking when the borradh link was sent and ignored past timeout', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      primaryCalendarType: 'borradh',
      primaryCalendarAccountId: null,
    });
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      metadata: { bookingLinkSentAt: elapsedLinkSentAt() },
      status: 'bot_handling',
    });

    const result = await run();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.shouldOfferDirectBooking).toBe(true);
    expect(result.data.ignored).toBe(true);
  });

  it('does not offer when the org is not on the native booking system', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      primaryCalendarType: 'google',
      primaryCalendarAccountId: 'acct-1',
    });

    const result = await run();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.shouldOfferDirectBooking).toBe(false);
    expect(result.data.reason).toContain('native booking system');
    // Should short-circuit before loading the conversation.
    expect(mockDb.query.conversation.findFirst).not.toHaveBeenCalled();
  });

  it('does not offer when no booking link has been sent', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      primaryCalendarType: 'borradh',
      primaryCalendarAccountId: null,
    });
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      metadata: {},
      status: 'bot_handling',
    });

    const result = await run();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.shouldOfferDirectBooking).toBe(false);
    expect(result.data.reason).toContain('No booking link');
  });

  it('does not offer when the timeout has not yet elapsed', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      primaryCalendarType: 'borradh',
      primaryCalendarAccountId: null,
    });
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      metadata: { bookingLinkSentAt: new Date().toISOString() },
      status: 'bot_handling',
    });

    const result = await run();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.shouldOfferDirectBooking).toBe(false);
    expect(result.data.reason).toContain('Timeout not yet elapsed');
  });

  it('does not offer when direct booking was already offered', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      primaryCalendarType: 'borradh',
      primaryCalendarAccountId: null,
    });
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      metadata: {
        bookingLinkSentAt: elapsedLinkSentAt(),
        directBookingOfferedAt: new Date().toISOString(),
      },
      status: 'bot_handling',
    });

    const result = await run();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.shouldOfferDirectBooking).toBe(false);
    expect(result.data.ignored).toBe(true);
    expect(result.data.reason).toContain('already offered');
  });

  it('does not offer when the conversation is no longer bot_handling', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      primaryCalendarType: 'borradh',
      primaryCalendarAccountId: null,
    });
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      metadata: { bookingLinkSentAt: elapsedLinkSentAt() },
      status: 'agent_handling',
    });

    const result = await run();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.shouldOfferDirectBooking).toBe(false);
    expect(result.data.reason).toContain('no longer handled by bot');
  });

  it('returns NOT_FOUND when the organization is missing', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(null);

    const result = await run();

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });
});
