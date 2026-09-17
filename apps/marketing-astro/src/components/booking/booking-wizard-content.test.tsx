// @vitest-environment jsdom

import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from './test-render';

/**
 * Component tests for the multi-service booking cart wizard.
 *
 * Ported from `apps/app/src/routes/book/-components/booking-wizard-content.test.tsx`.
 * Same cases, same assertions in substance; the mechanics differ only where
 * this app lacks a dependency (see `./test-render` — `fireEvent` instead of
 * `user-event`, plain assertions instead of jest-dom matchers).
 *
 * The behaviour that matters on the public booking page is the CART: what the
 * running total says as services go in and out, that you cannot advance with an
 * empty cart, and that the payload we finally POST carries the exact set of
 * service ids the guest picked.
 *
 * The date-time step (a heavy child that fetches its own slots) is stubbed to a
 * single button that confirms a fixed slot — it is not the unit under test; the
 * submit PAYLOAD is.
 */

const get = vi.fn();
const post = vi.fn();

// The marketing app's booking hooks call `@/lib/api-client` (apps/app calls
// `@borradh-workspace/api-client`); this is the same seam under a new name.
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// `info` matters: the submit hook calls it on the pay-first path, and a mock
// missing it throws inside onSuccess — swallowing the redirect entirely.
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// The portal prefill is a separate concern with its own transport; a live fetch
// here would just 401 noisily in jsdom.
vi.mock('./use-prefill-from-portal-session', () => ({
  usePrefillFromPortalSession: () => undefined,
}));

// Stand in for the real picker: one button that confirms a fixed slot, so we
// can assert the payload without driving a date strip + slot fetch in jsdom.
const PICKED_START = '2026-08-01T09:00:00.000Z';
const PICKED_END = '2026-08-01T09:30:00.000Z';
vi.mock('./wizard-datetime-step', () => ({
  WizardDateTimeStep: ({
    onSelect,
  }: {
    onSelect: (
      slot: { startTime: string; endTime: string },
      date: Date
    ) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onSelect(
          { startTime: PICKED_START, endTime: PICKED_END },
          new Date(PICKED_START)
        )
      }
    >
      pick-slot
    </button>
  ),
}));

const { BookingWizardContent } = await import('./booking-wizard-content');

const service = (overrides?: Record<string, unknown>) => ({
  id: 'svc-haircut',
  name: 'Haircut',
  pricingDescription: '£25',
  priceType: 'fixed',
  priceCents: 2500,
  appointmentDuration: 30,
  description: null,
  // null policy = inherit the org defaults, which is what 1,696 of the real
  // catalogue's active services carry.
  payment: {
    paymentPolicy: null,
    depositBasis: null,
    depositAmountCents: null,
    depositPercent: null,
  },
  category: null,
  variants: [],
  ...overrides,
});

/** Org defaults as they arrive from `/public/booking/:slug`. */
const paymentDefaults = (overrides?: Record<string, unknown>) => ({
  defaultPaymentPolicy: 'in_clinic',
  defaultDepositBasis: 'fixed',
  defaultDepositAmountCents: null,
  defaultDepositPercent: null,
  depositAggregation: 'sum',
  ...overrides,
});

const config = (
  services: Array<Record<string, unknown>>,
  overrides?: Record<string, unknown>
) => ({
  organizationName: 'Sharp Cuts',
  organizationSlug: 'sharp-cuts',
  organizationLogo: null,
  // The org display currency drives the symbol (it was once inferred from a "£"
  // in the freeform price string).
  currency: { code: 'GBP', symbol: '£' },
  paymentDefaults: paymentDefaults(),
  services,
  ...overrides,
});

const renderPage = () =>
  renderWithProviders(<BookingWizardContent organizationSlug="sharp-cuts" />);

const cartPanel = () =>
  screen.getByRole('complementary', { name: /booking summary/i });

const click = (el: Element) => fireEvent.click(el);
const type = (el: Element, value: string) =>
  fireEvent.change(el, { target: { value } });

describe('BookingWizardContent (cart wizard)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    post.mockResolvedValue({
      leadId: 'lead-1',
      appointmentId: 'appt-1',
      appointmentStartTime: PICKED_START,
      appointmentEndTime: PICKED_END,
    });
  });

  it('adds two services to the cart with an exact running total when both are priced', async () => {
    get.mockResolvedValue(
      config([
        service(),
        service({
          id: 'svc-beard',
          name: 'Beard trim',
          pricingDescription: '£20',
          priceCents: 2000,
        }),
      ])
    );

    renderPage();

    click(await screen.findByRole('button', { name: /add haircut/i }));
    click(screen.getByRole('button', { name: /add beard trim/i }));

    const panel = within(cartPanel());
    expect(panel.getByText('Haircut')).toBeTruthy();
    expect(panel.getByText('Beard trim')).toBeTruthy();
    // Both priced → exact total £45.
    expect(screen.getByTestId('cart-total').textContent).toContain('£45');
  });

  it('shows a "from" total when a selected service has no price', async () => {
    get.mockResolvedValue(
      config([
        service(),
        service({
          id: 'svc-consult',
          name: 'Consultation',
          pricingDescription: null,
          priceCents: null,
        }),
      ])
    );

    renderPage();

    click(await screen.findByRole('button', { name: /add haircut/i }));
    click(screen.getByRole('button', { name: /add consultation/i }));

    // Only the haircut is priced → the total is unknowable: "from £25".
    expect(screen.getByTestId('cart-total').textContent).toContain('from £25');
  });

  it('gates Continue on a non-empty cart', async () => {
    get.mockResolvedValue(config([service()]));

    renderPage();

    await screen.findByRole('button', { name: /add haircut/i });

    const panel = within(cartPanel());
    expect(
      (panel.getByRole('button', { name: /continue/i }) as HTMLButtonElement)
        .disabled
    ).toBe(true);

    click(screen.getByRole('button', { name: /add haircut/i }));

    expect(
      (panel.getByRole('button', { name: /continue/i }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  it('opens a chooser for a variant service and carts the picked option at its price', async () => {
    get.mockResolvedValue(
      config([
        service({
          id: 'svc-botox',
          name: 'Botox',
          // A variant service: no single price — the customer must pick one.
          priceType: 'from',
          priceCents: 16000,
          variants: [
            {
              id: 'var-1area',
              name: '1 Area',
              priceCents: 16000,
              durationMinutes: 30,
            },
            {
              id: 'var-2area',
              name: '2 Areas',
              priceCents: 19000,
              durationMinutes: 45,
            },
          ],
        }),
      ])
    );

    renderPage();

    // Clicking add on a variant service opens the chooser rather than adding.
    click(await screen.findByRole('button', { name: /add botox/i }));
    const chooser = await screen.findByRole('dialog');
    expect(within(chooser).getByText('2 Areas')).toBeTruthy();

    // Pick the £190 option and confirm.
    click(within(chooser).getByLabelText(/2 Areas/i));
    click(within(chooser).getByRole('button', { name: /add to booking/i }));

    // The cart carries the chosen variant at its own price (£190, not the £160 floor).
    const panel = within(cartPanel());
    expect(panel.getByText(/2 Areas/)).toBeTruthy();
    expect(screen.getByTestId('cart-total').textContent).toContain('£190');
  });

  it('posts serviceItems with the chosen variantId for a variant service', async () => {
    get.mockResolvedValue(
      config([
        service({
          id: 'svc-botox',
          name: 'Botox',
          priceType: 'from',
          priceCents: 16000,
          variants: [
            {
              id: 'var-2area',
              name: '2 Areas',
              priceCents: 19000,
              durationMinutes: 45,
            },
          ],
        }),
      ])
    );

    renderPage();

    click(await screen.findByRole('button', { name: /add botox/i }));
    const chooser = await screen.findByRole('dialog');
    click(within(chooser).getByRole('button', { name: /add to booking/i }));

    click(within(cartPanel()).getByRole('button', { name: /continue/i }));
    click(await screen.findByRole('button', { name: 'pick-slot' }));
    click(within(cartPanel()).getByRole('button', { name: /continue/i }));
    type(await screen.findByLabelText(/first name/i), 'Sam');
    type(await screen.findByLabelText(/email/i), 'sam@example.com');
    click(within(cartPanel()).getByRole('button', { name: /confirm/i }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        'public/booking/sharp-cuts/submit',
        expect.objectContaining({
          serviceId: 'svc-botox',
          serviceItems: [{ serviceId: 'svc-botox', variantId: 'var-2area' }],
          firstName: 'Sam',
        })
      );
    });
  });

  it('submits with serviceIds carrying exactly the selected ids', async () => {
    get.mockResolvedValue(
      config([
        service(),
        service({
          id: 'svc-beard',
          name: 'Beard trim',
          pricingDescription: '£20',
          priceCents: 2000,
        }),
      ])
    );

    renderPage();

    // Services step: add both.
    click(await screen.findByRole('button', { name: /add haircut/i }));
    click(screen.getByRole('button', { name: /add beard trim/i }));
    click(within(cartPanel()).getByRole('button', { name: /continue/i }));

    // Time step (stubbed): confirm the fixed slot, then continue.
    click(await screen.findByRole('button', { name: 'pick-slot' }));
    click(within(cartPanel()).getByRole('button', { name: /continue/i }));

    // Confirm step: name and email are required, then Confirm.
    type(await screen.findByLabelText(/first name/i), 'Jordan');
    type(await screen.findByLabelText(/email/i), 'jordan@example.com');
    click(within(cartPanel()).getByRole('button', { name: /confirm/i }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        'public/booking/sharp-cuts/submit',
        expect.objectContaining({
          serviceId: 'svc-haircut',
          serviceIds: ['svc-haircut', 'svc-beard'],
          // No-variant services post serviceItems with variantId omitted.
          serviceItems: [
            { serviceId: 'svc-haircut', variantId: undefined },
            { serviceId: 'svc-beard', variantId: undefined },
          ],
          firstName: 'Jordan',
        })
      );
    });
  });

  /**
   * The CTA has to name what the server will actually charge.
   *
   * A production booking read "Pay deposit & book", took no payment, and landed
   * on "Appointment confirmed": the page computed the deposit from the
   * pre-policy fields (`requiresDeposit` / `depositEnabled`) while the server
   * had moved to `payment_policy`. The clinic's policy said `in_clinic`, so
   * nothing was charged for an appointment it thought carried a £20 deposit.
   */
  const advanceToConfirmStep = async () => {
    click(await screen.findByRole('button', { name: /add haircut/i }));
    click(within(cartPanel()).getByRole('button', { name: /continue/i }));
    click(await screen.findByRole('button', { name: 'pick-slot' }));
    click(within(cartPanel()).getByRole('button', { name: /continue/i }));
    await screen.findByLabelText(/first name/i);
  };

  it('offers plain Confirm when the org policy takes payment in clinic', async () => {
    // The exact shape that broke: a legacy deposit amount still sitting on the
    // org, and a policy that says take nothing online. The amount must not
    // resurrect the pay button.
    get.mockResolvedValue(
      config([service({ requiresDeposit: true, depositAmountCents: 2000 })], {
        paymentDefaults: paymentDefaults({
          defaultPaymentPolicy: 'in_clinic',
          defaultDepositAmountCents: 2000,
        }),
        // The pre-policy fields, still present and still saying "deposit".
        // Reading either of these again reintroduces the bug, and fails here.
        depositEnabled: true,
        depositAmountCents: 2000,
      })
    );

    renderPage();
    await advanceToConfirmStep();

    expect(
      within(cartPanel()).getByRole('button', { name: /^confirm$/i })
    ).toBeTruthy();
    expect(
      within(cartPanel()).queryByRole('button', { name: /pay/i })
    ).toBeNull();
  });

  it('asks for the deposit when the org policy actually takes one', async () => {
    get.mockResolvedValue(
      config([service()], {
        paymentDefaults: paymentDefaults({
          defaultPaymentPolicy: 'deposit',
          defaultDepositAmountCents: 2000,
        }),
      })
    );

    renderPage();
    await advanceToConfirmStep();

    expect(
      within(cartPanel()).getByRole('button', { name: /pay deposit & book/i })
    ).toBeTruthy();
  });

  it('says pay, not pay-deposit, when the service prepays in full', async () => {
    get.mockResolvedValue(
      config([service({ payment: { paymentPolicy: 'full' } })])
    );

    renderPage();
    await advanceToConfirmStep();

    expect(
      within(cartPanel()).getByRole('button', { name: /^pay & book$/i })
    ).toBeTruthy();
    // The summary line sits directly under that button. Calling the whole
    // price a "deposit" here is the same mislabelling one line lower.
    const due = screen.getByTestId('cart-deposit-due');
    expect(due.textContent).toMatch(/due today/i);
    expect(due.textContent).not.toMatch(/deposit/i);
  });

  it('calls the summary line a deposit only when it is one', async () => {
    get.mockResolvedValue(
      config([service()], {
        paymentDefaults: paymentDefaults({
          defaultPaymentPolicy: 'deposit',
          defaultDepositAmountCents: 2000,
        }),
      })
    );

    renderPage();
    await advanceToConfirmStep();

    expect(screen.getByTestId('cart-deposit-due').textContent).toMatch(
      /deposit due today/i
    );
  });

  it('does not call a full prepay a deposit on the way to Stripe', async () => {
    // jsdom throws on a real navigation, which would swallow the hand-off
    // render, so `window.location` is stood in for and restored after.
    const realLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: {
        ...realLocation,
        href: '',
        origin: 'https://sharpcuts.example',
        search: '',
        pathname: '/book/sharp-cuts',
      },
    });
    onTestFinished(() => {
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: realLocation,
      });
    });

    get.mockResolvedValue(
      config([service({ payment: { paymentPolicy: 'full' } })])
    );
    // The server reports WHY it charged; the screen must not assume "deposit".
    post.mockResolvedValue({
      leadId: 'lead-1',
      appointmentId: 'appt-1',
      appointmentStartTime: PICKED_START,
      appointmentEndTime: PICKED_END,
      deposit: {
        amountCents: 2500,
        currency: 'gbp',
        checkoutUrl: 'https://checkout.stripe.com/x',
        reason: 'full',
      },
    });

    renderPage();
    await advanceToConfirmStep();
    type(screen.getByLabelText(/first name/i), 'Jordan');
    type(screen.getByLabelText(/email/i), 'jordan@example.com');
    click(within(cartPanel()).getByRole('button', { name: /pay & book/i }));

    // The hand-off screen is what a paying customer actually sees.
    const handoff = await screen.findByText(/taking you to stripe/i);
    expect(handoff.textContent).not.toMatch(/deposit/i);
    expect(window.location.href).toBe('https://checkout.stripe.com/x');
  });

  it('sends the customer back to THIS site after Stripe, not to the app', async () => {
    // Not in the apps/app suite, because there the return URL is deliberately
    // rewritten onto the web-app origin. On a microsite the page origin IS the
    // public one — returning them to app.borradh.io would drop the customer out
    // of the clinic's own site mid-payment.
    const realLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: {
        ...realLocation,
        href: '',
        origin: 'https://sharpcuts.example',
        search: '',
        pathname: '/book/sharp-cuts',
      },
    });
    onTestFinished(() => {
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: realLocation,
      });
    });

    get.mockResolvedValue(config([service()]));

    renderPage();
    await advanceToConfirmStep();
    type(screen.getByLabelText(/first name/i), 'Jordan');
    type(screen.getByLabelText(/email/i), 'jordan@example.com');
    click(within(cartPanel()).getByRole('button', { name: /confirm/i }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        'public/booking/sharp-cuts/submit',
        expect.objectContaining({
          bookingPageUrl: 'https://sharpcuts.example/book/sharp-cuts',
        })
      );
    });
  });
});
