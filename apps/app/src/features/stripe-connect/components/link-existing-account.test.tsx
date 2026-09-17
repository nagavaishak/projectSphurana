import { renderWithProviders, screen, waitFor } from '@/test/render';
import { vi } from 'vitest';

/**
 * The paste-an-account-id path on the payments settings panel.
 *
 * It exists for the sales-led onboarding flow: the merchant finishes Stripe
 * onboarding from a link sent after the call, so by the time an onboarding
 * specialist opens this page there is nothing left for "Set up payments" to
 * collect — the account id is the only handle onto it.
 *
 * What is worth pinning is the shape check in front of the button. Without it
 * the first thing an operator learns about a mistyped id is a server error, and
 * the id they typed is the one thing in this flow that nobody else can verify.
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

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  useGetAccountStatus: () => ({ status: mockStatus, isLoading: false }),
  useRefreshAccountStatus: () => ({ refreshAccountStatus: vi.fn() }),
  useCreateAccountSession: () => ({ createAccountSessionAsync: vi.fn() }),
}));

import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { StripeConnectPanel } from './stripe-connect-panel';

/** Mutable status the mocked hook reads per render. */
let mockStatus: Record<string, unknown> = {};

const ENDPOINT = 'integrations/stripe/link-account';

const disconnected = {
  connected: false,
  accountType: null,
  chargesEnabled: false,
  payoutsEnabled: false,
  detailsSubmitted: false,
  requirementsCurrentlyDue: [],
  disabledReason: null,
};

const openForm = async (user: ReturnType<typeof userEvent.setup>) => {
  renderWithProviders(<StripeConnectPanel />);
  await user.click(
    screen.getByRole('button', { name: /link an existing account/i })
  );
  return screen.getByLabelText(/stripe account id/i);
};

describe('link an existing Stripe account', () => {
  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({ ...disconnected, connected: true });
    get.mockReset();
    get.mockResolvedValue(null);
    mockStatus = disconnected;
  });

  it('posts the pasted account id', async () => {
    const user = userEvent.setup();
    const input = await openForm(user);

    await user.type(input, 'acct_1A2b3C4d5E6f7G8h');
    await user.click(screen.getByRole('button', { name: /^connect$/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const call = post.mock.calls.find((c) => c[0] === ENDPOINT);
    expect(call?.[1]).toEqual({ stripeAccountId: 'acct_1A2b3C4d5E6f7G8h' });
  });

  it('trims a copied id rather than sending the whitespace', async () => {
    const user = userEvent.setup();
    const input = await openForm(user);

    await user.type(input, '  acct_1A2b3C4d ');
    await user.click(screen.getByRole('button', { name: /^connect$/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const call = post.mock.calls.find((c) => c[0] === ENDPOINT);
    expect(call?.[1]).toEqual({ stripeAccountId: 'acct_1A2b3C4d' });
  });

  it.each([
    ['a secret key pasted by mistake', 'sk_live_51ABCdef'],
    ['a customer id', 'cus_1A2b3C4d'],
  ])('will not submit %s', async (_label, value) => {
    const user = userEvent.setup();
    const input = await openForm(user);

    await user.type(input, value);

    expect(screen.getByRole('button', { name: /^connect$/i })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('is not offered once an account is connected', () => {
    // Connected but still mid-onboarding: the panel keeps showing "Set up
    // payments", and this is exactly where a second account id must NOT be
    // pasteable — the server refuses a repoint, and disconnecting is the
    // honest way through.
    mockStatus = {
      ...disconnected,
      connected: true,
      accountType: 'controller',
    };
    renderWithProviders(<StripeConnectPanel />);

    expect(
      screen.queryByRole('button', { name: /link an existing account/i })
    ).toBeNull();
  });
});
