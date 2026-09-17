/**
 * State-machine tests for the usage banner. `apps/web` has no test runner
 * yet (claire.md §1 cross-cutting gotcha), so this file is excluded from
 * `pnpm typecheck` via the root tsconfig glob (`src/**\/*.test.ts`).
 * It ships as a typed contract spec next to the pure helper; a future
 * vitest runner will pick it up automatically.
 */
import { describe, expect, it } from 'vitest';

import type { AssistantUsageResponse } from '@/features/assistant';
import { getUsageBannerState } from './usage-banner-state';

const buildUsage = (
  overrides: Partial<AssistantUsageResponse> & {
    daily?: Partial<AssistantUsageResponse['daily']>;
    monthly?: Partial<AssistantUsageResponse['monthly']>;
  } = {}
): AssistantUsageResponse => {
  const dailyLimit = overrides.daily?.limit ?? 100;
  const monthlyLimit = overrides.monthly?.limit ?? 2000;
  const dailyUsed = overrides.daily?.used ?? 0;
  const monthlyUsed = overrides.monthly?.used ?? 0;
  return {
    planId: overrides.planId ?? 'pro',
    hasAccess: overrides.hasAccess ?? true,
    daily: {
      used: dailyUsed,
      limit: dailyLimit,
      remaining: Math.max(0, dailyLimit - dailyUsed),
      ...overrides.daily,
    },
    monthly: {
      used: monthlyUsed,
      limit: monthlyLimit,
      remaining: Math.max(0, monthlyLimit - monthlyUsed),
      ...overrides.monthly,
    },
  };
};

describe('getUsageBannerState', () => {
  it('returns hidden when usage is null', () => {
    expect(getUsageBannerState(null)).toEqual({ kind: 'hidden' });
  });

  it('returns hidden when daily usage is below 50%', () => {
    const state = getUsageBannerState(buildUsage({ daily: { used: 49 } }));
    expect(state.kind).toBe('hidden');
  });

  it('returns subtle at exactly 50% daily', () => {
    const state = getUsageBannerState(buildUsage({ daily: { used: 50 } }));
    expect(state.kind).toBe('subtle');
  });

  it('returns subtle between 50% and 80% daily', () => {
    const state = getUsageBannerState(buildUsage({ daily: { used: 65 } }));
    expect(state.kind).toBe('subtle');
  });

  it('returns warning at exactly 80% daily', () => {
    const state = getUsageBannerState(buildUsage({ daily: { used: 80 } }));
    expect(state.kind).toBe('warning');
    if (state.kind === 'warning') {
      expect(state.remaining).toBe(20);
    }
  });

  it('returns warning between 80% and 100% daily', () => {
    const state = getUsageBannerState(buildUsage({ daily: { used: 95 } }));
    expect(state.kind).toBe('warning');
  });

  it('returns daily-limit-paid when paid plan hits 100%', () => {
    const state = getUsageBannerState(buildUsage({ daily: { used: 100 } }));
    expect(state.kind).toBe('daily-limit-paid');
  });

  it('returns daily-limit-paid when paid plan exceeds 100%', () => {
    // Backend may briefly report used > limit on race; banner still hits
    // the limit state.
    const state = getUsageBannerState(buildUsage({ daily: { used: 105 } }));
    expect(state.kind).toBe('daily-limit-paid');
  });

  it('returns daily-limit-free when free plan hits its quota', () => {
    // Free-with-quota is theoretical (current free plan has limit=0 and
    // is gated at the page level). This branch keeps the upsell path
    // covered for a future free-trial tier.
    const state = getUsageBannerState(
      buildUsage({
        planId: 'free',
        hasAccess: false,
        daily: { used: 5, limit: 5 },
      })
    );
    expect(state.kind).toBe('daily-limit-free');
  });

  it('returns free-tier-active for a free plan with unused quota', () => {
    const state = getUsageBannerState(
      buildUsage({
        planId: 'free',
        hasAccess: false,
        daily: { used: 1, limit: 5 },
      })
    );
    expect(state.kind).toBe('free-tier-active');
    if (state.kind === 'free-tier-active') {
      expect(state.remaining).toBe(4);
    }
  });

  it('returns hidden for current free plan (limit=0) — page-level gate handles UX', () => {
    const state = getUsageBannerState(
      buildUsage({
        planId: 'free',
        hasAccess: false,
        daily: { used: 0, limit: 0 },
        monthly: { used: 0, limit: 0 },
      })
    );
    expect(state.kind).toBe('hidden');
  });

  it('returns monthly-limit-paid when daily is fine but monthly is exhausted', () => {
    const state = getUsageBannerState(
      buildUsage({
        daily: { used: 0 },
        monthly: { used: 2000 },
      })
    );
    expect(state.kind).toBe('monthly-limit-paid');
  });

  it('returns monthly-warning when monthly crosses 80% but daily is fine', () => {
    const state = getUsageBannerState(
      buildUsage({
        daily: { used: 0 },
        monthly: { used: 1700 },
      })
    );
    expect(state.kind).toBe('monthly-warning');
  });

  it('prefers daily-limit over monthly-warning when both trigger', () => {
    const state = getUsageBannerState(
      buildUsage({
        daily: { used: 100 },
        monthly: { used: 1700 },
      })
    );
    expect(state.kind).toBe('daily-limit-paid');
  });

  it('handles enterprise-tier limits identically (no special-casing)', () => {
    const state = getUsageBannerState(
      buildUsage({
        planId: 'enterprise',
        daily: { used: 250, limit: 500 },
      })
    );
    expect(state.kind).toBe('subtle');
  });
});
