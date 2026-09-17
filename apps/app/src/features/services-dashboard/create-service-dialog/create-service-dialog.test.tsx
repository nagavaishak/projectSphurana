import { renderWithProviders, screen, waitFor } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors the E2E catalog/services.spec.ts + appointments/services.spec.ts
// 3-step create wizard (Basic Details → Pricing & Duration → Team Members).
// Categories + practitioners are read through apiClient.get; the service is
// written through useCreateService → apiClient.post('organization-services').
const post = vi.fn();
const put = vi.fn();
const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
    delete: (..._a: unknown[]) => vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from 'sonner';
import { CreateServiceDialog } from './create-service-dialog';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as never;
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}

/**
 * Rooms & equipment fixtures. A category with `resourceCount: 0` must NOT
 * surface — a requirement nothing can satisfy would only make the service
 * unbookable.
 */
const ROOM_CATEGORY = {
  id: 'cat-rooms',
  organizationId: 'org_1',
  name: 'Treatment rooms',
  kind: 'room' as const,
  description: null,
  sortOrder: 0,
  isActive: true,
  resourceCount: 2,
};
const ROOMS = [
  { id: 'res-1', categoryId: 'cat-rooms', name: 'Room 1', isActive: true },
  { id: 'res-2', categoryId: 'cat-rooms', name: 'Room 2', isActive: true },
];

describe('CreateServiceDialog', () => {
  const EMPTY: never[] = [];
  const EMPTY_ITEMS = { items: EMPTY };

  beforeEach(() => {
    post.mockResolvedValue({ id: 'new-service' });
    put.mockResolvedValue({});
    get.mockImplementation((path: string) =>
      path.includes('stripe')
        ? Promise.resolve({ isActive: true, chargesEnabled: true })
        : path.includes('practitioner') || path.includes('location')
          ? Promise.resolve(EMPTY_ITEMS)
          : Promise.resolve(EMPTY)
    );
  });

  /** Give the org one room category with two rooms in it. */
  const withRooms = () => {
    get.mockImplementation((path: string) => {
      if (path.includes('stripe')) {
        return Promise.resolve({ isActive: true, chargesEnabled: true });
      }
      if (path.includes('practitioner') || path.includes('location')) {
        return Promise.resolve(EMPTY_ITEMS);
      }
      // The categories sub-path must resolve BEFORE the generic resources list.
      if (path.startsWith('resources/categories')) {
        return Promise.resolve([ROOM_CATEGORY]);
      }
      if (path.startsWith('resources')) return Promise.resolve(ROOMS);
      return Promise.resolve(EMPTY);
    });
  };

  /** Walk to step 2 ("Pricing and Duration"), where the section lives. */
  const gotoPricingStep = async (
    user: ReturnType<typeof userEvent.setup>,
    name: string
  ) => {
    await user.type(screen.getByLabelText('Service Name'), name);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: '2. Pricing and Duration' });
  };

  /** Step 2 → step 3 → save. */
  const saveFromPricingStep = async (
    user: ReturnType<typeof userEvent.setup>
  ) => {
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Save Service' }));
  };

  const requirementsCall = () =>
    put.mock.calls.find((c) => c[0] === 'resources/requirements/new-service');

  it('renders step 1 with the service-name field', () => {
    renderWithProviders(<CreateServiceDialog open onOpenChange={() => {}} />);
    expect(
      screen.getByRole('heading', { name: '1. Basic Details' })
    ).toBeVisible();
    expect(screen.getByLabelText('Service Name')).toBeVisible();
  });

  it('disables Continue on step 1 until a name is entered', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateServiceDialog open onOpenChange={() => {}} />);

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await user.type(screen.getByLabelText('Service Name'), 'Haircut');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('drives the wizard and creates a service with the expected payload', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <CreateServiceDialog open onOpenChange={onOpenChange} />
    );

    // Step 1
    await user.type(screen.getByLabelText('Service Name'), 'Haircut');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // Step 2 — duration defaults to 60m; set a price.
    expect(
      await screen.findByRole('heading', { name: '2. Pricing and Duration' })
    ).toBeVisible();
    await user.type(screen.getByPlaceholderText('0.00'), '50');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // Step 3 — save (no practitioners).
    expect(
      await screen.findByRole('heading', { name: '3. Team Members' })
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save Service' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith(
      'organization-services',
      expect.objectContaining({
        name: 'Haircut',
        category: 'treatment',
        appointmentDuration: 60,
        priceType: 'fixed',
        priceCents: 5000,
        isCustom: true,
        isActive: true,
        requiresDeposit: false,
      })
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('adds a pricing option and posts it against the new service', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <CreateServiceDialog open onOpenChange={onOpenChange} />
    );

    // Step 1
    await user.type(screen.getByLabelText('Service Name'), 'Botox');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // Step 2 — open the collapsible pricing options and add one.
    await screen.findByRole('heading', { name: '2. Pricing and Duration' });
    await user.click(screen.getByRole('button', { name: /pricing options/i }));
    await user.click(
      screen.getByRole('button', { name: /add pricing option/i })
    );

    await user.type(screen.getByLabelText('Option name'), '1 Area');
    // With an option present the service amount is hidden; the only 0.00 input
    // left is the option's own price.
    await user.type(screen.getByPlaceholderText('0.00'), '160');

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Save Service' }));

    // The service is created "from" the cheapest option (16000 cents)…
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        'organization-services',
        expect.objectContaining({
          name: 'Botox',
          priceType: 'from',
          priceCents: 16000,
        })
      )
    );
    // …and the option is posted against that new service.
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        'organization-services/new-service/variants',
        expect.objectContaining({
          name: '1 Area',
          priceCents: 16000,
          sortOrder: 0,
        })
      )
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('pre-fills the deposit amount from the last service that charges one', async () => {
    // The org already has a service with a €25 deposit — a NEW service that
    // turns its deposit on should inherit that amount so it isn't re-typed.
    get.mockImplementation((path: string) => {
      if (path.includes('stripe')) {
        return Promise.resolve({ isActive: true, chargesEnabled: true });
      }
      if (path.includes('practitioner') || path.includes('location')) {
        return Promise.resolve(EMPTY_ITEMS);
      }
      if (path.startsWith('organization-services')) {
        return Promise.resolve({
          items: [
            {
              id: 'svc-existing',
              name: 'Existing',
              requiresDeposit: true,
              depositAmountCents: 2500,
              updatedAt: '2025-01-01T00:00:00.000Z',
            },
          ],
        });
      }
      return Promise.resolve(EMPTY);
    });

    const user = userEvent.setup();
    renderWithProviders(<CreateServiceDialog open onOpenChange={() => {}} />);

    await user.type(screen.getByLabelText('Service Name'), 'Facial');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: '2. Pricing and Duration' });

    // No amount before the switch is on.
    expect(screen.queryByLabelText(/deposit amount/i)).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('switch', { name: /requires a deposit/i })
    );

    // Seeded from the remembered €25 — not blank.
    expect(await screen.findByLabelText(/deposit amount/i)).toHaveValue(25);
  });

  // ── Rooms & equipment ─────────────────────────────────────────────────────

  it('hides the rooms & equipment section for an org with no resources', async () => {
    // Every clinic starts here. The form must look EXACTLY as it did before the
    // feature existed — no switch, no turnaround, and no write to the endpoint.
    const user = userEvent.setup();
    renderWithProviders(<CreateServiceDialog open onOpenChange={() => {}} />);

    await gotoPricingStep(user, 'Haircut');

    expect(screen.queryByText('Rooms & equipment')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('switch', { name: /requires a room/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Turnaround time')).not.toBeInTheDocument();

    await saveFromPricingStep(user);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(requirementsCall()).toBeUndefined();
  });

  it('hides a resource category that has no resources in it', async () => {
    // A requirement nothing can satisfy makes every slot unbookable.
    get.mockImplementation((path: string) => {
      if (path.includes('stripe')) {
        return Promise.resolve({ isActive: true, chargesEnabled: true });
      }
      if (path.includes('practitioner') || path.includes('location')) {
        return Promise.resolve(EMPTY_ITEMS);
      }
      if (path.startsWith('resources/categories')) {
        return Promise.resolve([{ ...ROOM_CATEGORY, resourceCount: 0 }]);
      }
      return Promise.resolve(EMPTY);
    });

    const user = userEvent.setup();
    renderWithProviders(<CreateServiceDialog open onOpenChange={() => {}} />);
    await gotoPricingStep(user, 'Haircut');

    expect(screen.queryByText('Rooms & equipment')).not.toBeInTheDocument();
  });

  it('sends an EMPTY eligible list for "Any room" — empty means ANY, not none', async () => {
    withRooms();
    const user = userEvent.setup();
    renderWithProviders(<CreateServiceDialog open onOpenChange={() => {}} />);

    await gotoPricingStep(user, 'Facial');

    const requiresRoom = await screen.findByRole('switch', {
      name: /requires a room/i,
    });
    await user.click(requiresRoom);

    // Switching the requirement on defaults to "Any room".
    expect(await screen.findByLabelText('Any room')).toBeChecked();
    expect(screen.getByLabelText('Room 1')).not.toBeChecked();

    await saveFromPricingStep(user);

    await waitFor(() => expect(requirementsCall()).toBeDefined());
    expect(requirementsCall()?.[1]).toEqual({
      // 0 minutes of turnaround reaches the wire as null, not 0.
      turnaroundMinutes: null,
      requirements: [{ categoryId: 'cat-rooms', eligibleResourceIds: [] }],
    });
  });

  it('sends the chosen ids when the requirement is narrowed to specific rooms', async () => {
    withRooms();
    const user = userEvent.setup();
    renderWithProviders(<CreateServiceDialog open onOpenChange={() => {}} />);

    await gotoPricingStep(user, 'Facial');
    await user.click(
      await screen.findByRole('switch', { name: /requires a room/i })
    );
    await user.click(await screen.findByLabelText('Room 2'));

    // Narrowing to a specific room turns "Any room" off.
    expect(screen.getByLabelText('Any room')).not.toBeChecked();

    await saveFromPricingStep(user);

    await waitFor(() => expect(requirementsCall()).toBeDefined());
    expect(requirementsCall()?.[1]).toEqual({
      turnaroundMinutes: null,
      requirements: [
        { categoryId: 'cat-rooms', eligibleResourceIds: ['res-2'] },
      ],
    });
  });

  it('widens back to an empty list when "Any room" is re-selected', async () => {
    withRooms();
    const user = userEvent.setup();
    renderWithProviders(<CreateServiceDialog open onOpenChange={() => {}} />);

    await gotoPricingStep(user, 'Facial');
    await user.click(
      await screen.findByRole('switch', { name: /requires a room/i })
    );
    await user.click(await screen.findByLabelText('Room 2'));
    await user.click(screen.getByLabelText('Any room'));

    await saveFromPricingStep(user);

    await waitFor(() => expect(requirementsCall()).toBeDefined());
    expect(requirementsCall()?.[1]).toMatchObject({
      requirements: [{ categoryId: 'cat-rooms', eligibleResourceIds: [] }],
    });
  });

  it('sends a stepped turnaround, and null once it is stepped back to 0', async () => {
    withRooms();
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(
      <CreateServiceDialog open onOpenChange={() => {}} />
    );

    await gotoPricingStep(user, 'Peel');
    await user.click(
      await screen.findByRole('switch', { name: /requires a room/i })
    );

    const increase = screen.getByRole('button', {
      name: 'Increase turnaround time',
    });
    await user.click(increase);
    await user.click(increase);
    expect(screen.getByLabelText('Turnaround time')).toHaveValue(10);

    await saveFromPricingStep(user);
    await waitFor(() => expect(requirementsCall()).toBeDefined());
    expect(requirementsCall()?.[1]).toMatchObject({ turnaroundMinutes: 10 });

    unmount();
    put.mockClear();

    // Same walk, but stepped back down to 0 — which must reach the wire as null.
    const user2 = userEvent.setup();
    renderWithProviders(<CreateServiceDialog open onOpenChange={() => {}} />);
    await gotoPricingStep(user2, 'Peel');
    await user2.click(
      await screen.findByRole('switch', { name: /requires a room/i })
    );
    const up = screen.getByRole('button', { name: 'Increase turnaround time' });
    await user2.click(up);
    await user2.click(
      screen.getByRole('button', { name: 'Decrease turnaround time' })
    );
    expect(screen.getByLabelText('Turnaround time')).toHaveValue(0);

    await saveFromPricingStep(user2);
    await waitFor(() => expect(requirementsCall()).toBeDefined());
    expect(requirementsCall()?.[1]).toMatchObject({ turnaroundMinutes: null });
  });

  it('creates the service FIRST, then writes its requirements', async () => {
    // The endpoint is keyed by service id, which does not exist until the POST
    // comes back — so the ordering is load-bearing, not incidental.
    withRooms();
    const user = userEvent.setup();
    renderWithProviders(<CreateServiceDialog open onOpenChange={() => {}} />);

    await gotoPricingStep(user, 'Facial');
    await user.click(
      await screen.findByRole('switch', { name: /requires a room/i })
    );
    await saveFromPricingStep(user);

    await waitFor(() => expect(requirementsCall()).toBeDefined());
    expect(post).toHaveBeenCalledWith(
      'organization-services',
      expect.objectContaining({ name: 'Facial' })
    );
    // The PUT is addressed with the id the POST returned…
    expect(requirementsCall()?.[0]).toBe('resources/requirements/new-service');
    // …and it ran after it.
    const createOrder = post.mock.invocationCallOrder[0];
    const requirementsOrder =
      put.mock.invocationCallOrder[
        put.mock.calls.findIndex(
          (c) => c[0] === 'resources/requirements/new-service'
        )
      ];
    expect(requirementsOrder).toBeGreaterThan(createOrder);
  });

  it('does not re-create the service when the requirements write fails', async () => {
    // The service already exists by then. A retry must UPDATE it, not leave the
    // clinic with a duplicate — and the user's room selection must survive.
    withRooms();
    put.mockRejectedValueOnce(new Error('requirements boom'));
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <CreateServiceDialog open onOpenChange={onOpenChange} />
    );

    await gotoPricingStep(user, 'Facial');
    await user.click(
      await screen.findByRole('switch', { name: /requires a room/i })
    );
    await user.click(await screen.findByLabelText('Room 1'));
    await saveFromPricingStep(user);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('requirements boom')
    );
    // The wizard stays open on the team step with the selection intact.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    // Retry: the service is UPDATED, not created a second time…
    await user.click(screen.getByRole('button', { name: 'Save Service' }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        'organization-services/new-service',
        expect.objectContaining({ name: 'Facial' })
      )
    );
    expect(post).toHaveBeenCalledTimes(1);
    // …and the room the user picked is still what gets written.
    await waitFor(() => expect(requirementsCall()).toBeDefined());
    expect(requirementsCall()?.[1]).toMatchObject({
      requirements: [
        { categoryId: 'cat-rooms', eligibleResourceIds: ['res-1'] },
      ],
    });
  });

  it('keeps the dialog open and toasts when the create fails', async () => {
    post.mockRejectedValueOnce(new Error('service boom'));
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <CreateServiceDialog open onOpenChange={onOpenChange} />
    );

    await user.type(screen.getByLabelText('Service Name'), 'Haircut');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Save Service' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('service boom')
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
