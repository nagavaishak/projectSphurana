import { vi } from 'vitest';
import * as metaAdsShared from '../index.js';

/**
 * Canonical test control surface for `meta-ads/services/_shared/index.js`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The features suite runs with `pool: 'threads'` + `isolate: false`, so every
 * test file in a worker shares ONE module graph. A file-local
 * `vi.mock('../_shared/index.js', () => ({ ... }))` therefore persists for the
 * rest of the run — and because a BARE factory (one that does not spread
 * `importOriginal()`) replaces the module wholesale, it effectively DELETES
 * every export it omits.
 *
 * Nine test files used to do exactly that, each with a DIFFERENT subset, so
 * whichever file ran last won and any later file needing an omitted export
 * failed with "No 'x' export is defined on the mock" (or silently called
 * `undefined`). That made `launch-ad` and `sync-all-ads` — which use the REAL
 * `_shared` — fail under shuffled seeds.
 *
 * The fix, per the maintenance rule in `vite.config.ts`: control INTERNAL
 * modules with a RESTORED `vi.spyOn` rather than `vi.mock`. Spies installed
 * here are torn down in `afterEach`, so nothing leaks past the test that
 * installed them, and the module keeps its full export surface at all times.
 *
 * `meta-campaigns/services/_shared/index.js` is a pure re-export of
 * `getMetaCredentials` from this module. Vite's SSR transform compiles
 * re-exports to live getters, so spying here propagates through it — which is
 * why both service groups share this one fixture instead of diverging again.
 *
 * USAGE
 * -----
 * ```ts
 * import {
 *   installMetaAdsSharedSpies,
 *   metaAdsSharedMocks,
 *   restoreMetaAdsSharedSpies,
 * } from '../_shared/__fixtures__/shared-spies.js';
 *
 * describe('publishAd', () => {
 *   beforeEach(() => {
 *     vi.clearAllMocks();
 *     installMetaAdsSharedSpies('getMetaCredentials', 'resolveAdSet');
 *   });
 *   afterEach(restoreMetaAdsSharedSpies);
 *
 *   it('...', () => {
 *     metaAdsSharedMocks.getMetaCredentials.mockResolvedValueOnce({ ... });
 *   });
 * });
 * ```
 *
 * The `metaAdsSharedMocks` handles are module-level and STABLE, so a test file
 * may destructure them at module scope; `installMetaAdsSharedSpies` only wires
 * the (fresh, restorable) spy through to them.
 */
export const metaAdsSharedMocks = {
  buildAdCreative: vi.fn(),
  getMetaCredentials: vi.fn(),
  handleMetaError: vi.fn(),
  resolveAdSet: vi.fn(),
  resolveMediaAsset: vi.fn(),
  setAdError: vi.fn(),
  uploadMediaToMeta: vi.fn(),
};

export type MetaAdsSharedMockName = keyof typeof metaAdsSharedMocks;

/**
 * The module namespace object. Vite's SSR transform defines exports as
 * configurable accessors, so `vi.spyOn` can replace them (same pattern the
 * vertical-config registry uses) — the cast just widens the per-export
 * signatures to a uniform callable so one loop can install them all.
 */
const spyTarget = metaAdsShared as unknown as Record<
  MetaAdsSharedMockName,
  (...args: unknown[]) => unknown
>;

let installed: { mockRestore: () => void }[] = [];

/**
 * Spy on the named `_shared` exports, delegating each to its stable
 * `metaAdsSharedMocks` handle. Call from `beforeEach`; pair with
 * `restoreMetaAdsSharedSpies` in `afterEach`.
 */
export const installMetaAdsSharedSpies = (
  ...names: MetaAdsSharedMockName[]
): typeof metaAdsSharedMocks => {
  for (const name of names) {
    const spy = vi
      .spyOn(spyTarget, name)
      .mockImplementation((...args: unknown[]) =>
        metaAdsSharedMocks[name](...args)
      );
    installed.push(spy);
  }
  return metaAdsSharedMocks;
};

/** Restore every spy installed by `installMetaAdsSharedSpies`. */
export const restoreMetaAdsSharedSpies = (): void => {
  for (const spy of installed) spy.mockRestore();
  installed = [];
};
