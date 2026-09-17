import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The /reset-password route's `beforeLoad` guard.
 *
 * REGRESSION: this route used to be gated like /sign-in — any visitor with a
 * session was bounced to their post-auth landing page. That swallowed emailed
 * reset links whole: better-auth's changePassword leaves the current session
 * alive, so the device someone reads email on stays signed in while they are
 * locked out everywhere else. Clicking the link there landed them on the
 * dashboard and the form never rendered, so no reset could ever be submitted.
 * A customer reported reset links "doing nothing" for a month; server logs
 * showed zero POST /auth/reset-password from them in 90 days, because the
 * form was never on screen.
 *
 * The guard must therefore let a link-carrying request through REGARDLESS of
 * session state. These tests pin that open door.
 */

// `createFileRoute` is stubbed so the route object simply exposes its options —
// no router, no route tree.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  createFileRoute: () => (opts: unknown) => ({ options: opts }),
}));

const ensureSession = vi.fn();
const getPostAuthRedirect = vi.fn();

vi.mock('@/lib/session', () => ({ ensureSession: () => ensureSession() }));
vi.mock('@/lib/auth-landing', () => ({
  getPostAuthRedirect: (session: unknown) => getPostAuthRedirect(session),
}));

import { isRedirect } from '@tanstack/react-router';
import { Route } from './reset-password';

type Search = { token?: string; error?: string };
type BeforeLoad = (ctx: { search: Search }) => Promise<void>;

/** Run the guard, returning whatever it threw (or null when it fell through). */
const runGuard = async (search: Search): Promise<unknown> => {
  const beforeLoad = (
    Route as unknown as { options: { beforeLoad: BeforeLoad } }
  ).options.beforeLoad;
  try {
    await beforeLoad({ search });
    return null;
  } catch (error) {
    return error;
  }
};

/** `redirect()` nests its target under `.options.to`. */
const redirectTo = (thrown: unknown): string | undefined =>
  (thrown as { options?: { to?: string } })?.options?.to;

/** A fully signed-in, onboarded user — the state that used to eat the link. */
const signedIn = () => {
  ensureSession.mockResolvedValue({
    user: { id: 'u1', email: 'user@example.com', emailVerified: true },
    session: { id: 's1' },
  });
  getPostAuthRedirect.mockResolvedValue('/dashboard/home');
};

const signedOut = () => {
  ensureSession.mockResolvedValue({ user: null, session: null });
  getPostAuthRedirect.mockResolvedValue(null);
};

describe('/reset-password route · beforeLoad guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the form for a signed-in user following a reset link', async () => {
    signedIn();

    expect(await runGuard({ token: 'a-real-token' })).toBeNull();
  });

  it('does not even look up the session when a token is present', async () => {
    signedIn();

    await runGuard({ token: 'a-real-token' });

    // The link is self-authorising. Consulting the session here is what
    // reintroduces the bug, so the call itself is the thing under test.
    expect(ensureSession).not.toHaveBeenCalled();
    expect(getPostAuthRedirect).not.toHaveBeenCalled();
  });

  it('renders the form for a signed-out user following a reset link', async () => {
    signedOut();

    expect(await runGuard({ token: 'a-real-token' })).toBeNull();
  });

  it('shows the invalid-link screen rather than redirecting when a signed-in user follows an expired link', async () => {
    signedIn();

    // `?error=INVALID_TOKEN` must reach the component, which explains the
    // failure and offers a fresh link. Redirecting instead is the same silent
    // dead end from the customer's side.
    expect(await runGuard({ error: 'INVALID_TOKEN' })).toBeNull();
    expect(ensureSession).not.toHaveBeenCalled();
  });

  it('still redirects a signed-in user who arrives with no link at all', async () => {
    signedIn();

    // Bare /reset-password carries no intent to reset — that visitor genuinely
    // belongs in the app, so the original behaviour is preserved.
    const thrown = await runGuard({});

    expect(isRedirect(thrown)).toBe(true);
    expect(redirectTo(thrown)).toBe('/dashboard/home');
  });

  it('lets a signed-out user with no link through to the invalid-link screen', async () => {
    signedOut();

    expect(await runGuard({})).toBeNull();
  });

  it('does not redirect a session-holder whose landing page is undecided', async () => {
    ensureSession.mockResolvedValue({
      user: { id: 'u1', email: 'user@example.com', emailVerified: false },
      session: { id: 's1' },
    });
    getPostAuthRedirect.mockResolvedValue(null);

    expect(await runGuard({})).toBeNull();
  });
});
