/**
 * Gradual-rollout bucketing — the "10% of users" primitive.
 *
 * Pure, deterministic, dependency-free. Given a flag key, a *stable* unit id
 * (per-user or per-org — never per-request), and a target percentage, decide
 * whether that unit is inside the rollout. The same `(flagKey, unitId)` pair
 * always lands in the same bucket, so a ramp from 10% → 50% only *adds* units
 * (monotonic) and never reshuffles who's already in.
 *
 * This is the local mirror of PostHog's percentage rollout: it lets callers
 * compute "am I in the canary?" without a network round-trip, and lets a real
 * {@link FlagProvider} be swapped in later without changing call sites. Per the
 * release-safety strategy, gradual rollout is **only coherent per-user-or-org**;
 * do not feed a per-request id here.
 */

/**
 * FNV-1a 32-bit hash. Small, fast, stable across runs and platforms (no
 * dependency on JS string hashing internals). Chosen for a roughly uniform
 * spread of arbitrary ids across the 0..99 bucket space — not for crypto.
 */
const fnv1a32 = (input: string): number => {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in 32-bit range.
    hash = Math.imul(hash, 0x01000193);
  }
  // Coerce to an unsigned 32-bit integer.
  return hash >>> 0;
};

/**
 * The stable bucket (0..99) a unit falls into for a given flag. Exposed for
 * tests and for callers that want the raw bucket (e.g. to log it). The flag key
 * is part of the hash input so the same unit gets independent buckets across
 * different flags (one flag's canary cohort isn't another's).
 */
export const rolloutBucket = (flagKey: string, unitId: string): number =>
  fnv1a32(`${flagKey}:${unitId}`) % 100;

/**
 * Whether `unitId` is inside a `percentage`-sized rollout of `flagKey`.
 *
 * - `percentage <= 0` → nobody (always `false`).
 * - `percentage >= 100` → everybody (always `false` only for empty input; see below).
 * - Deterministic: same inputs → same answer every call.
 * - Monotonic: a unit in at 10% is also in at any higher percentage.
 *
 * `percentage` is clamped to `[0, 100]` and floored to an integer, so a bucket
 * in `0..99` is "in" iff `bucket < percentage`. A missing/empty `unitId`
 * returns `false` (we can't stably bucket an unidentified unit, so treat it as
 * the safe out-of-rollout default rather than guess).
 */
export const isInRollout = (
  flagKey: string,
  unitId: string,
  percentage: number
): boolean => {
  if (!unitId) return false;
  if (!Number.isFinite(percentage)) return false;
  const pct = Math.min(100, Math.max(0, Math.floor(percentage)));
  if (pct <= 0) return false;
  if (pct >= 100) return true;
  return rolloutBucket(flagKey, unitId) < pct;
};
