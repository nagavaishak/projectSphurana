import { describe, expect, it } from '@borradh-workspace/testing';

import {
  canResolveAvailability,
  nativeBookingLink,
} from './native-calendar.js';

describe('canResolveAvailability', () => {
  it('is true for a native org even though it has no calendar account id', () => {
    // The regression this function exists for. A native org's availability
    // lives in `shift` rows, so `primaryCalendarAccountId` is always null —
    // the old inline `type && accountId` check made every one of them look
    // unconfigured and withheld the availability tool from the chatbot.
    expect(
      canResolveAvailability({
        bookingDestination: 'borradh',
        primaryCalendarType: 'borradh',
        primaryCalendarAccountId: null,
      })
    ).toBe(true);
  });

  it('is true for a linked external calendar', () => {
    expect(
      canResolveAvailability({
        bookingDestination: 'external',
        primaryCalendarType: 'google_calendar',
        primaryCalendarAccountId: 'cal_123',
      })
    ).toBe(true);
  });

  it('is false for an external calendar type with no account linked', () => {
    // Half-finished integration: we cannot resolve slots, so the bot must not
    // be told it can.
    expect(
      canResolveAvailability({
        bookingDestination: 'external',
        primaryCalendarType: 'google_calendar',
        primaryCalendarAccountId: null,
      })
    ).toBe(false);
  });

  it('is false for an org with no calendar configured at all', () => {
    expect(
      canResolveAvailability({
        bookingDestination: null,
        primaryCalendarType: null,
        primaryCalendarAccountId: null,
      })
    ).toBe(false);
  });

  it('falls back to primaryCalendarType while bookingDestination is unset', () => {
    // Expand/contract window (ENG-500): callers that have not selected the new
    // column yet must still resolve native orgs correctly.
    expect(
      canResolveAvailability({
        primaryCalendarType: 'borradh',
        primaryCalendarAccountId: null,
      })
    ).toBe(true);
  });
});

// Mirrors microsite-links.test.ts: MARKETING is the marketing app, which is
// the only host that serves booking.
const MARKETING = 'https://mock-marketing.example.com';

describe('nativeBookingLink', () => {
  it('names the branch when the caller knows which one', () => {
    // Claire's case. `resolveConversationBranch` has named a branch and her
    // quoted prices belong to it, so the link must land on that branch's form
    // rather than the chooser.
    expect(nativeBookingLink({ slug: 'glow-clinic' }, null, 'cork')).toBe(
      `${MARKETING}/sites/glow-clinic/l/cork/book`
    );
  });

  it('returns the un-branched entry when no branch was resolved', () => {
    expect(nativeBookingLink({ slug: 'glow-clinic' }, null)).toBe(
      `${MARKETING}/sites/glow-clinic/book`
    );
  });

  it('is null without a slug, and never falls back to an external link', () => {
    // A native org carrying a stale defaultBookingLink must surface NO link
    // rather than one pointing into a booking system Borradh cannot see.
    expect(nativeBookingLink({ slug: null }, null, 'cork')).toBeNull();
  });
});
