/**
 * The verification backoff, as pure functions.
 *
 * Pure on purpose: the schedule is the part of this feature a human reasons
 * about ("why is it still saying pending after an hour?") and the part a test
 * can pin exactly, without Redis, a provider, or a clock.
 */

import {
  VERIFY_BACKOFF_LADDER,
  VERIFY_BACKOFF_MAX_MS,
  VERIFY_GIVE_UP_MS,
} from './domain-verification.constants.js';

/** Gap to leave before the next `provider.verify()` for a domain this old. */
export const nextVerificationDelayMs = (elapsedMs: number): number => {
  for (const step of VERIFY_BACKOFF_LADDER) {
    if (elapsedMs < step.withinMs) return step.everyMs;
  }
  return VERIFY_BACKOFF_MAX_MS;
};

/** 7 days without an `active` is a terminal state, not a longer wait. */
export const hasExhaustedVerification = (elapsedMs: number): boolean =>
  elapsedMs >= VERIFY_GIVE_UP_MS;

export interface DueInput {
  /** When the domain was added — the clock the ladder is measured from. */
  createdAt: Date;
  /** Last `provider.verify()` for this domain, or null if never polled. */
  lastCheckedAt: Date | null;
  now: Date;
}

/**
 * Is this domain due for another check?
 *
 * A never-checked domain is always due. Otherwise the gap since the last check
 * has to have reached the ladder's current rung. An exhausted domain is also
 * "due" — the work owed is the give-up transition, which the caller performs.
 */
export const isDueForVerification = ({
  createdAt,
  lastCheckedAt,
  now,
}: DueInput): boolean => {
  const elapsed = now.getTime() - createdAt.getTime();
  if (hasExhaustedVerification(elapsed)) return true;
  if (!lastCheckedAt) return true;
  return (
    now.getTime() - lastCheckedAt.getTime() >= nextVerificationDelayMs(elapsed)
  );
};
