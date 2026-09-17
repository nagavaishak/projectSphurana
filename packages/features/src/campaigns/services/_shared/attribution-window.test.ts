import { describe, expect, it } from '@borradh-workspace/testing';
import {
  attributeConversion,
  isWithinAttributionWindow,
} from './attribution-window.js';

const d = (iso: string) => new Date(iso);

describe('isWithinAttributionWindow', () => {
  it('true when conversion is within the window after the send', () => {
    expect(
      isWithinAttributionWindow(d('2026-01-01'), d('2026-01-10'), 14)
    ).toBe(true);
  });

  it('false when conversion is after the window', () => {
    expect(
      isWithinAttributionWindow(d('2026-01-01'), d('2026-01-20'), 14)
    ).toBe(false);
  });

  it('false when conversion happened before the send', () => {
    expect(
      isWithinAttributionWindow(d('2026-01-10'), d('2026-01-01'), 14)
    ).toBe(false);
  });
});

describe('attributeConversion', () => {
  const conv = d('2026-01-15');

  it('picks the most recent in-window send (last touch)', () => {
    const result = attributeConversion(
      [
        { campaignId: 'old', sentAt: d('2026-01-02') },
        { campaignId: 'recent', sentAt: d('2026-01-12') },
      ],
      conv,
      14
    );
    expect(result).toBe('recent');
  });

  it('ignores sends outside the window', () => {
    const result = attributeConversion(
      [
        { campaignId: 'too-old', sentAt: d('2025-12-01') },
        { campaignId: 'in-window', sentAt: d('2026-01-05') },
      ],
      conv,
      14
    );
    expect(result).toBe('in-window');
  });

  it('returns null when nothing qualifies', () => {
    expect(
      attributeConversion(
        [{ campaignId: 'x', sentAt: d('2025-01-01') }],
        conv,
        14
      )
    ).toBeNull();
  });
});
