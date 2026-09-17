import { describe, expect, it, vi } from 'vitest';

/**
 * The /welcome layout route's `beforeLoad` guard.
 *
 * The Claire Typeform deck is built but is NOT the live onboarding — the legacy
 * wizard at /onboarding is (see `getPostAuthRedirect`). The deck stayed
 * reachable by URL, which let a user drop into a second, parallel flow that
 * creates its own organization, so the guard now closes the route
 * unconditionally.
 *
 * This spec pins that shut door. It previously covered the deck's own gating
 * (no session → /sign-in, completed onboarding → /dashboard/home); those cases
 * are in git history and should come back with the deck if it is switched on.
 */

// `createFileRoute` is stubbed so the route object simply exposes its options —
// no router, no route tree.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  createFileRoute: () => (opts: unknown) => ({ options: opts }),
}));

vi.mock('@/features/onboarding/api', () => ({
  useResetOnboarding: () => ({ resetOnboarding: vi.fn(), isResetting: false }),
}));

import { isRedirect } from '@tanstack/react-router';
import { Route } from './welcome';

type BeforeLoad = () => void;

/** Run the guard, returning whatever it threw (or null when it fell through). */
const runGuard = async (): Promise<unknown> => {
  const beforeLoad = (
    Route as unknown as { options: { beforeLoad: BeforeLoad } }
  ).options.beforeLoad;
  try {
    await beforeLoad();
    return null;
  } catch (error) {
    return error;
  }
};

/** `redirect()` nests its target under `.options.to`. */
const redirectTo = (thrown: unknown): string | undefined =>
  (thrown as { options?: { to?: string } })?.options?.to;

describe('/welcome route · beforeLoad guard', () => {
  it('redirects to the live onboarding wizard', async () => {
    const thrown = await runGuard();

    expect(isRedirect(thrown)).toBe(true);
    expect(redirectTo(thrown)).toBe('/onboarding');
  });

  it('never falls through — the deck must not be reachable by URL', async () => {
    // Guards against the redirect being made conditional again by accident:
    // any path that returns instead of throwing renders the parallel flow.
    for (let i = 0; i < 3; i++) {
      expect(await runGuard()).not.toBeNull();
    }
  });
});
