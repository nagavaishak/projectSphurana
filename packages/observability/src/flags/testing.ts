/**
 * Flag-aware test-execution helpers.
 *
 * Lets OTHER packages'/apps' tests run a flag-guarded code path against a known,
 * deterministic flag state — without a live PostHog. Build a {@link FlagProvider}
 * from a plain `{ key: boolean }` map and inject it where production injects the
 * real {@link postHogFlagProvider}; the path under test then resolves through the
 * same {@link resolveFlag}/{@link resolveKillSwitch} machinery, so you test the
 * real wiring, not a bypass.
 *
 * ## CI default flag state convention
 *
 * A flag-guarded path has TWO behaviours; a test should pin the one it means to
 * exercise rather than depend on ambient config:
 *
 * - **Intended-on** (the new/guarded path): `withFlags({ 'my-flag': true })`.
 * - **Intended-off / legacy** (the safe default): `withFlags({})` (or
 *   {@link allFlagsOff}) — every flag reads `undefined` → the caller's safe
 *   default, which by convention is OFF.
 *
 * **CI default = all flags OFF.** Tests that don't opt a flag on get the
 * conservative default path. A new feature behind a flag therefore ships dark in
 * CI until a test explicitly turns it on, mirroring the production "default-off
 * until rollout" posture. Pin the on-state in the spec that covers the new path.
 */

import { type FlagProvider, staticProvider } from './provider.js';

/**
 * Build a deterministic, synchronous {@link FlagProvider} from a `key → boolean`
 * map for use in tests. Unknown keys return `undefined` (→ the caller's safe
 * default), so you only list the flags the path under test cares about.
 *
 * @example
 * ```ts
 * // exercise the new path
 * const provider = withFlags({ 'http-retry-v2': true });
 * const enabled = await resolveFlag(provider, 'http-retry-v2', { unitId: orgId });
 * expect(enabled).toBe(true);
 *
 * // exercise the legacy/off path (CI default)
 * const off = withFlags({}); // or allFlagsOff()
 * expect(await resolveFlag(off, 'http-retry-v2', { unitId: orgId })).toBe(false);
 * ```
 */
export const withFlags = (map: Record<string, boolean> = {}): FlagProvider =>
  staticProvider(map);

/**
 * A {@link FlagProvider} where every flag is unconfigured → resolves to the safe
 * default (OFF by convention). The explicit name for the CI-default state; same
 * as `withFlags({})` but reads intent-first at a call site.
 */
export const allFlagsOff = (): FlagProvider => staticProvider({});

/**
 * A {@link FlagProvider} that forces the listed flags ON (and only those).
 * Sugar over {@link withFlags} for the common "turn these features on for this
 * test" case.
 *
 * @example `allFlagsOn('flag-a', 'flag-b')`
 */
export const allFlagsOn = (...keys: string[]): FlagProvider =>
  staticProvider(Object.fromEntries(keys.map((k) => [k, true])));
