// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from './test-render';

/**
 * The branch has to reach all three public booking calls, and a single-branch
 * org has to come out of that unchanged.
 *
 * WHY A SEPARATE FILE from `booking-wizard-content.test.tsx`: that suite stubs
 * `wizard-datetime-step` down to one button, which is exactly the component
 * that issues the slots call. Half of what matters here is the slots URL, so
 * this file lets the real step render and stubs nothing but the transport.
 *
 * The bar for every case below is the same one Phase 1 set on the API side
 * (`single-branch-location-parity.test.ts`): with NO branch, the request this
 * app sends must be byte-identical to the one it sent before branches existed
 * — not `?locationSlug=`, not a body with `locationSlug: undefined`. Those
 * orgs are almost all of production.
 */

const get = vi.fn();
const post = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('./use-prefill-from-portal-session', () => ({
  usePrefillFromPortalSession: () => undefined,
}));

const { BookingWizardContent } = await import('./booking-wizard-content');

const SLOT_START = '2026-08-03T09:00:00.000Z';

const service = () => ({
  id: 'svc-haircut',
  name: 'Haircut',
  pricingDescription: '£25',
  priceType: 'fixed',
  priceCents: 2500,
  appointmentDuration: 30,
  description: null,
  payment: {
    paymentPolicy: null,
    depositBasis: null,
    depositAmountCents: null,
    depositPercent: null,
  },
  category: null,
  variants: [],
});

const config = (overrides?: Record<string, unknown>) => ({
  organizationName: 'Sharp Cuts',
  organizationSlug: 'sharp-cuts',
  organizationLogo: null,
  currency: { code: 'GBP', symbol: '£' },
  // Pin the business timezone so the slot's rendered label is the same string
  // on every machine — the Time step formats slots in it, and a floating
  // browser-local fallback makes this suite TZ-dependent.
  timezone: 'UTC',
  paymentDefaults: {
    defaultPaymentPolicy: 'in_clinic',
    defaultDepositBasis: 'fixed',
    defaultDepositAmountCents: null,
    defaultDepositPercent: null,
    depositAggregation: 'sum',
  },
  services: [service()],
  ...overrides,
});

/**
 * One transport stub for both endpoints, routed on the URL — the wizard fires
 * the config call and (once the Time step renders) the slots call, and the
 * slots URL is half of what these tests assert.
 */
const routeGet = (configPayload: Record<string, unknown>) => {
  get.mockImplementation((url: string) => {
    if (url.includes('/slots'))
      return Promise.resolve({
        slots: [{ startTime: SLOT_START, endTime: '2026-08-03T09:30:00.000Z' }],
      });
    return Promise.resolve(configPayload);
  });
};

const renderPage = (locationSlug?: string) =>
  renderWithProviders(
    <BookingWizardContent
      organizationSlug="sharp-cuts"
      locationSlug={locationSlug}
    />
  );

const cartPanel = () =>
  screen.getByRole('complementary', { name: /booking summary/i });

const click = (el: Element) => fireEvent.click(el);
const type = (el: Element, value: string) =>
  fireEvent.change(el, { target: { value } });

/** Every GET this render issued whose URL names the slots endpoint. */
const slotsCalls = () =>
  get.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/slots'));

/** Services → Time. Resolves once the slots call for the day has gone out. */
const advanceToTimeStep = async () => {
  click(await screen.findByRole('button', { name: /add haircut/i }));
  click(within(cartPanel()).getByRole('button', { name: /continue/i }));
  await waitFor(() => expect(slotsCalls().length).toBeGreaterThan(0));
};

/** Services → Time → pick the one offered slot → Confirm. */
const advanceToConfirmStep = async () => {
  await advanceToTimeStep();
  click(await screen.findByRole('button', { name: /9:00/i }));
  click(within(cartPanel()).getByRole('button', { name: /continue/i }));
  await screen.findByLabelText(/first name/i);
};

const submitAsJordan = async () => {
  type(await screen.findByLabelText(/first name/i), 'Jordan');
  type(screen.getByLabelText(/email/i), 'jordan@example.com');
  click(within(cartPanel()).getByRole('button', { name: /confirm/i }));
};

describe('BookingWizardContent — branch scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    post.mockResolvedValue({
      leadId: 'lead-1',
      appointmentId: 'appt-1',
      appointmentStartTime: SLOT_START,
      appointmentEndTime: '2026-08-03T09:30:00.000Z',
    });
  });

  // ── The branch reaches all three calls ────────────────────────────────────

  it('scopes the config call to the branch', async () => {
    routeGet(config());

    renderPage('cork');

    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        'public/booking/sharp-cuts?locationSlug=cork'
      )
    );
  });

  it('scopes the slots call to the branch', async () => {
    routeGet(config());

    renderPage('cork');
    await advanceToTimeStep();

    // Not just "some call mentioned cork" — EVERY slots call must, or one
    // un-scoped day in the strip quietly offers the default branch's hours.
    for (const url of slotsCalls()) expect(url).toContain('locationSlug=cork');
  });

  it('stamps the branch on the submitted booking', async () => {
    routeGet(config());

    renderPage('cork');
    await advanceToConfirmStep();
    await submitAsJordan();

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        'public/booking/sharp-cuts/submit',
        expect.objectContaining({ locationSlug: 'cork' })
      )
    );
  });

  it('percent-encodes a branch slug rather than splicing it into the URL', async () => {
    routeGet(config());

    renderPage('cork&x=1');

    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        'public/booking/sharp-cuts?locationSlug=cork%26x%3D1'
      )
    );
  });

  // ── Single-branch parity: absent must stay absent ─────────────────────────

  it('sends no locationSlug at all on the config call when there is no branch', async () => {
    routeGet(config());

    renderPage();

    // The exact pre-branch URL. `?locationSlug=` would be a DIFFERENT request
    // and the API's optional-slug schema would reject the empty string.
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('public/booking/sharp-cuts')
    );
  });

  it('sends no locationSlug on the slots call when there is no branch', async () => {
    routeGet(config());

    renderPage();
    await advanceToTimeStep();

    for (const url of slotsCalls()) expect(url).not.toContain('locationSlug');
  });

  it('omits the locationSlug KEY from the submit body when there is no branch', async () => {
    routeGet(config());

    renderPage();
    await advanceToConfirmStep();
    await submitAsJordan();

    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0]?.[1] as Record<string, unknown>;
    // `toBeUndefined()` would pass on `{ locationSlug: undefined }`, which is
    // a different body on the wire once it is serialised through a client that
    // keeps undefined keys. The key must not be there.
    expect(Object.hasOwn(body, 'locationSlug')).toBe(false);
  });

  // ── The calendar invite names the branch ──────────────────────────────────

  it('puts the branch address on the calendar invite', async () => {
    routeGet(config({ organizationAddress: '12 Oliver Plunkett St, Cork' }));

    renderPage('cork');
    await advanceToConfirmStep();
    await submitAsJordan();

    const google = (await screen.findByRole('link', {
      name: /google/i,
    })) as HTMLAnchorElement;
    const location = new URL(google.href).searchParams.get('location');
    expect(location).toBe('12 Oliver Plunkett St, Cork');

    // Same event object feeds Outlook, so a regression that only wired Google
    // would be a half-fix.
    const outlook = (await screen.findByRole('link', {
      name: /outlook/i,
    })) as HTMLAnchorElement;
    expect(new URL(outlook.href).searchParams.get('location')).toBe(
      '12 Oliver Plunkett St, Cork'
    );
  });

  it('omits location entirely when the branch has no address on file', async () => {
    routeGet(config());

    renderPage('cork');
    await advanceToConfirmStep();
    await submitAsJordan();

    const google = (await screen.findByRole('link', {
      name: /google/i,
    })) as HTMLAnchorElement;
    // `location=` with nothing after it makes Google render an empty place
    // field; the builder must leave the param off.
    expect(new URL(google.href).searchParams.has('location')).toBe(false);
  });
});
