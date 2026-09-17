import { describe, expect, it } from 'vitest';

import { buildUpdateAdPayload } from './update-ad.payload';

/**
 * The wire body decides whether a LIVE ad gets a new creative.
 *
 * `updateAdImpl` rebuilds the creative when any of `headline`, `primaryText`,
 * `description`, `callToAction` or `destinationUrl` is present — presence, not
 * difference. So an over-generous payload is not merely wasteful: it swaps a
 * fresh creative onto a running ad and sends it back through Meta's review,
 * pausing delivery for an edit that never touched the creative.
 *
 * These tests pin the payload at exactly that boundary.
 */
const intent = {
  name: 'Autumn Haircut Promo',
  headline: 'Autumn cuts, booking now',
  primaryText: 'Chairs free this week.',
  description: 'Book online',
  callToAction: 'BOOK_NOW',
  destinationUrl: 'https://example.test/book',
  destinationLocked: false,
};

describe('buildUpdateAdPayload', () => {
  it('sends ONLY the name when only the name changed', () => {
    const payload = buildUpdateAdPayload(intent, ['name']);

    expect(payload).toEqual({ name: 'Autumn Haircut Promo' });
    // The regression this exists for: any of these five present rebuilds the
    // creative on a live ad.
    expect(payload).not.toHaveProperty('headline');
    expect(payload).not.toHaveProperty('primaryText');
    expect(payload).not.toHaveProperty('description');
    expect(payload).not.toHaveProperty('callToAction');
    expect(payload).not.toHaveProperty('destinationUrl');
  });

  it('sends a changed creative field, and only that one', () => {
    const payload = buildUpdateAdPayload(intent, ['name', 'headline']);

    expect(payload.headline).toBe('Autumn cuts, booking now');
    expect(payload).not.toHaveProperty('primaryText');
    expect(payload).not.toHaveProperty('description');
  });

  it('always carries the name — the wire type requires it', () => {
    const payload = buildUpdateAdPayload(intent, ['primaryText']);

    expect(payload.name).toBe('Autumn Haircut Promo');
    expect(payload.primaryText).toBe('Chairs free this week.');
  });

  it('drops CTA and URL when the destination is locked, even if edited', () => {
    const payload = buildUpdateAdPayload(
      { ...intent, destinationLocked: true },
      ['name', 'callToAction', 'destinationUrl']
    );

    // A messaging / lead-form ad derives both from its ad set; sending them
    // would be a no-op on Meta AND would rebuild the creative on the way.
    expect(payload).not.toHaveProperty('callToAction');
    expect(payload).not.toHaveProperty('destinationUrl');
    expect(payload).toEqual({ name: 'Autumn Haircut Promo' });
  });

  it('maps an emptied field to undefined, as the server expects', () => {
    const payload = buildUpdateAdPayload({ ...intent, description: '' }, [
      'description',
    ]);

    expect(payload.description).toBeUndefined();
  });

  it('sends nothing but the name for an empty change set', () => {
    expect(buildUpdateAdPayload(intent, [])).toEqual({
      name: 'Autumn Haircut Promo',
    });
  });
});
