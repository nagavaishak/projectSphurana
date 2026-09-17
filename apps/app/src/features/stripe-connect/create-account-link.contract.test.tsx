import { ROUTES } from '@/lib/route-paths';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `POST integrations/stripe/account-link` — start Stripe-hosted
 * onboarding.
 *
 * THIS OPERATION HAS NO FORM. Its body is two URLs, and the user types neither:
 * both surfaces read `window.location` and hand the shared
 * `buildCreateAccountLinkPayload` a `{ baseUrl }` intent, which is the only place
 * the `?stripe=return` / `?stripe=refresh` markers are appended. The user's whole
 * contribution is a click.
 *
 * So `form: null` + `noForm`: properties 1 and 2 have no field to seed or reach,
 * while 3 (payload correct) and 4 (surfaces agree) carry the real weight — the
 * settings panel and the sales banner previously hand-rolled those markers
 * inline, which is exactly the drift the shared builder closed.
 */

const post = vi.fn();
const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

/**
 * Stub only the STATUS hooks (they gate which surface renders its CTA).
 * `useCreateAccountLink` stays REAL, so the body under test is the one the
 * shared builder actually produces and hands to `apiClient.post`.
 */
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  useGetAccountStatus: () => ({ status: mockStatus, isLoading: false }),
  useRefreshAccountStatus: () => ({ refreshAccountStatus: vi.fn() }),
  useCreateAccountSession: () => ({ createAccountSessionAsync: vi.fn() }),
}));

import { SalesNotificationBanner } from './components/sales-notification-banner';
import { StripeConnectPanel } from './components/stripe-connect-panel';

/** Mutable status the mocked hook reads per render. */
let mockStatus: Record<string, unknown> = {};

const ENDPOINT = 'integrations/stripe/account-link';

/**
 * Both surfaces derive the base URL from the current location — the panel from
 * `ROUTES.settingsPayments`, the banner from `window.location.pathname`. Pin the
 * path so "the same place in the app" means the same base for both, which is the
 * only condition under which their bodies are comparable at all.
 */
const pinLocation = () =>
  window.history.replaceState({}, '', ROUTES.settingsPayments);

runFormContract({
  operation: 'POST integrations/stripe/account-link',
  description: 'Create Stripe account link',

  form: null,
  noForm:
    'No user-facing form: the body is a pair of return/refresh URLs derived from ' +
    'window.location by the shared builder. The user only clicks.',

  surfaces: [
    {
      name: 'settings stripe-connect-panel',
      run: async (ctx) => {
        mockStatus = {
          accountType: 'controller',
          detailsSubmitted: false,
          chargesEnabled: false,
        };
        pinLocation();
        renderWithProviders(<StripeConnectPanel />);

        await ctx.user.click(
          screen.getByRole('button', { name: /set up payments/i })
        );
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
    {
      name: 'sales-notification-banner',
      run: async (ctx) => {
        mockStatus = {
          accountType: 'controller',
          requirementsCurrentlyDue: ['individual.verification.document'],
        };
        pinLocation();
        renderWithProviders(<SalesNotificationBanner />);

        await ctx.user.click(
          screen.getByRole('button', { name: /complete setup/i })
        );
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
  ],

  reset: () => {
    post.mockReset();
    post.mockResolvedValue({ url: 'https://connect.stripe.test/setup/x' });
    get.mockReset();
    get.mockResolvedValue(null);
  },

  readBody: () => {
    const call = post.mock.calls.find((c) => c[0] === ENDPOINT);
    if (!call) throw new Error(`no POST ${ENDPOINT} call captured`);
    return call[1] as Record<string, unknown>;
  },

  // No fields to derive from — the builder's whole job is these two markers.
  expectedBody: () => {
    const base = `${window.location.origin}${ROUTES.settingsPayments}`;
    return {
      returnUrl: `${base}?stripe=return`,
      refreshUrl: `${base}?stripe=refresh`,
    };
  },
});
