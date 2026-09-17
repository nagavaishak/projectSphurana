import type { GiftCardExpiry } from '@borradh-workspace/labels';

interface ExpiryDuration {
  unit: 'day' | 'month' | 'year';
  count: number;
}

/**
 * Duration for each `gift_card_expiry` key (contract §1.1.8, keys from
 * `giftCardExpiryLabels`). `never` has no duration — it maps to a null expiry.
 */
const EXPIRY_DURATIONS: Record<
  Exclude<GiftCardExpiry, 'never'>,
  ExpiryDuration
> = {
  '14d': { unit: 'day', count: 14 },
  '1m': { unit: 'month', count: 1 },
  '2m': { unit: 'month', count: 2 },
  '3m': { unit: 'month', count: 3 },
  '6m': { unit: 'month', count: 6 },
  '1y': { unit: 'year', count: 1 },
  '2y': { unit: 'year', count: 2 },
  '3y': { unit: 'year', count: 3 },
  '5y': { unit: 'year', count: 5 },
};

/**
 * Compute a gift card's `expiresAt` from the org's `gift_card_expiry` setting:
 * `from` + the configured duration (calendar-aware month/year arithmetic).
 * `never` → `null` (no expiry).
 */
export const giftCardExpiryToDate = (
  expiry: GiftCardExpiry,
  from: Date
): Date | null => {
  if (expiry === 'never') return null;
  const { unit, count } = EXPIRY_DURATIONS[expiry];
  const result = new Date(from.getTime());
  if (unit === 'day') {
    result.setDate(result.getDate() + count);
  } else if (unit === 'month') {
    result.setMonth(result.getMonth() + count);
  } else {
    result.setFullYear(result.getFullYear() + count);
  }
  return result;
};
