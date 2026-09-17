import type { AssistantUsageResponse } from '@/features/assistant';

/**
 * Discriminated banner states. Kept as a pure function so the state
 * transitions can be exercised in isolation (see `usage-banner-state.test.ts`).
 *
 * Why pure? `apps/web` has no test runner yet (claire.md §1 cross-cutting
 * gotcha). Extracting the logic lets the state machine be covered the moment
 * a runner lands; meanwhile the file documents the contract.
 */

export type UsageBannerState =
  | { kind: 'hidden' }
  | { kind: 'subtle'; remaining: number; used: number; limit: number }
  | { kind: 'warning'; remaining: number; used: number; limit: number }
  | { kind: 'monthly-warning'; remaining: number; used: number; limit: number }
  | { kind: 'daily-limit-paid' }
  | { kind: 'daily-limit-free' }
  | { kind: 'monthly-limit-paid' }
  | { kind: 'monthly-limit-free' }
  | {
      kind: 'free-tier-active';
      remaining: number;
      used: number;
      limit: number;
    };

const SUBTLE_THRESHOLD = 0.5;
const WARNING_THRESHOLD = 0.8;

function ratio(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return used / limit;
}

export function getUsageBannerState(
  usage: AssistantUsageResponse | null
): UsageBannerState {
  if (!usage) return { kind: 'hidden' };

  const isFree = !usage.hasAccess;
  const dailyRatio = ratio(usage.daily.used, usage.daily.limit);
  const monthlyRatio = ratio(usage.monthly.used, usage.monthly.limit);

  // Daily cap takes precedence over monthly because it resets sooner —
  // the operator's next action is "wait until midnight" either way, so
  // the most-immediate reset window is the more useful message.
  if (usage.daily.limit > 0 && dailyRatio >= 1) {
    return isFree ? { kind: 'daily-limit-free' } : { kind: 'daily-limit-paid' };
  }

  if (usage.monthly.limit > 0 && monthlyRatio >= 1) {
    return isFree
      ? { kind: 'monthly-limit-free' }
      : { kind: 'monthly-limit-paid' };
  }

  // Free-tier orgs with a non-zero allowance (none today, but the schema
  // supports it) get an always-visible row with the upgrade CTA. The
  // landing-page gate at `/assistant` handles the hasAccess=false case so
  // we don't double-render — but if a future plan ships a free-with-quota
  // tier, this branch covers it.
  if (isFree && usage.daily.limit > 0) {
    return {
      kind: 'free-tier-active',
      remaining: usage.daily.remaining,
      used: usage.daily.used,
      limit: usage.daily.limit,
    };
  }

  // Paid-tier banner ramp.
  if (dailyRatio >= WARNING_THRESHOLD) {
    return {
      kind: 'warning',
      remaining: usage.daily.remaining,
      used: usage.daily.used,
      limit: usage.daily.limit,
    };
  }

  if (
    usage.monthly.limit > 0 &&
    monthlyRatio >= WARNING_THRESHOLD &&
    monthlyRatio < 1
  ) {
    return {
      kind: 'monthly-warning',
      remaining: usage.monthly.remaining,
      used: usage.monthly.used,
      limit: usage.monthly.limit,
    };
  }

  if (dailyRatio >= SUBTLE_THRESHOLD) {
    return {
      kind: 'subtle',
      remaining: usage.daily.remaining,
      used: usage.daily.used,
      limit: usage.daily.limit,
    };
  }

  return { kind: 'hidden' };
}
