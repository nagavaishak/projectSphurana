import type { MembershipValidFor } from '@borradh-workspace/labels';

interface ValidForDuration {
  unit: 'day' | 'month' | 'year';
  count: number;
}

const VALID_FOR_DURATIONS: Record<MembershipValidFor, ValidForDuration> = {
  '7d': { unit: 'day', count: 7 },
  '14d': { unit: 'day', count: 14 },
  '1m': { unit: 'month', count: 1 },
  '2m': { unit: 'month', count: 2 },
  '3m': { unit: 'month', count: 3 },
  '4m': { unit: 'month', count: 4 },
  '6m': { unit: 'month', count: 6 },
  '8m': { unit: 'month', count: 8 },
  '1y': { unit: 'year', count: 1 },
  '18m': { unit: 'month', count: 18 },
  '2y': { unit: 'year', count: 2 },
  '3y': { unit: 'year', count: 3 },
  '5y': { unit: 'year', count: 5 },
};

/**
 * Compute the expiry date for a one_time membership: `from` + the plan's
 * `validFor` duration (calendar-aware month/year arithmetic via Date).
 */
export const validForToDate = (
  from: Date,
  validFor: MembershipValidFor
): Date => {
  const { unit, count } = VALID_FOR_DURATIONS[validFor];
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

export interface StripeRecurringInterval {
  interval: 'day' | 'week' | 'month' | 'year';
  intervalCount: number;
}

/**
 * Map a plan's `validFor` to the Stripe recurring price interval for
 * recurring memberships (the billing cycle IS the validity window).
 * Day-based windows map to weeks where they divide evenly (Stripe caps
 * total billing intervals, and 7d/14d are exactly 1/2 weeks).
 */
export const validForToStripeInterval = (
  validFor: MembershipValidFor
): StripeRecurringInterval => {
  const { unit, count } = VALID_FOR_DURATIONS[validFor];
  if (unit === 'day' && count % 7 === 0) {
    return { interval: 'week', intervalCount: count / 7 };
  }
  return { interval: unit, intervalCount: count };
};
