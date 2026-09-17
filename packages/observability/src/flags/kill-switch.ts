/**
 * Kill-switch resolution with a SAFE FALLBACK.
 *
 * A kill-switch is an operational "instant disable" for a cross-cutting runtime
 * change that isn't per-user (e.g. outbound-HTTP timeout/retry behaviour, queue
 * idempotency). The single rule this module enforces: **a flag-eval outage must
 * never hard-fail and must never silently enable risky new code.** When the
 * provider is unavailable, returns `undefined`, or throws, we fall back to a
 * conservative default — by convention OFF (the new/guarded path disabled, the
 * old path kept).
 *
 * `defaultEnabled` lets a caller invert that for the rare flag whose *safe*
 * state is on (e.g. a guard that should stay enabled unless explicitly turned
 * off). It is the value used **only** when the provider gives no clear answer —
 * an explicit `true`/`false` from the provider always wins.
 */

/**
 * A provider-returned flag state. `boolean` is a definitive answer; `undefined`
 * means "no opinion / not configured"; an `Error` (or any thrown value surfaced
 * as one) means the eval failed. The last two both resolve to the safe default.
 */
export type KillSwitchState = boolean | undefined | null | Error;

export interface ResolveKillSwitchOptions {
  /**
   * The value to use when the provider gives no definitive answer (undefined,
   * null, or an error). Defaults to `false` — the conservative "new path off".
   */
  defaultEnabled?: boolean;
}

/**
 * Resolve a kill-switch to a definitive boolean.
 *
 * - Provider returned `true`/`false` → honor it verbatim.
 * - Provider returned `undefined`/`null` (not configured) → `defaultEnabled`.
 * - Provider returned/threw an `Error` → `defaultEnabled` (degrade safely).
 *
 * This function never throws. Callers can pass the result of a `try/catch`
 * around a real provider lookup (the caught error as `state`) and trust that a
 * provider blip degrades to the safe default rather than taking down the path
 * the switch guards.
 *
 * @example
 * ```ts
 * let state: KillSwitchState;
 * try {
 *   state = await provider.getFlag('http-retry-v2', { unitId: orgId });
 * } catch (err) {
 *   state = err as Error; // eval failed → safe default below
 * }
 * const enabled = resolveKillSwitch(state, { defaultEnabled: false });
 * ```
 */
export const resolveKillSwitch = (
  state: KillSwitchState,
  options: ResolveKillSwitchOptions = {}
): boolean => {
  const defaultEnabled = options.defaultEnabled ?? false;
  if (typeof state === 'boolean') return state;
  // undefined | null | Error → no definitive answer → safe default.
  return defaultEnabled;
};
