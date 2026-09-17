import {
  createTestQueryClient,
  renderWithProviders,
  screen,
  waitFor,
} from '@/test/render';
import type { OrganizationService } from '@borradh-workspace/api-client/types';
import {
  fixture,
  organizationServiceSchema,
} from '@borradh-workspace/contracts';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors the E2E catalog/services.spec.ts "edit a service and persist the new
// name" flow: re-opening the wizard hydrates the saved values, and saving
// PUTs the updated service through useUpdateService.
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
import { EditServiceDialog } from './edit-service-dialog';

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

const service: OrganizationService = fixture(organizationServiceSchema, {
  id: 'svc1',
  organizationId: 'org_1',
  name: 'Haircut',
  description: 'A trim',
  category: 'treatment',
  categoryId: null,
  sortOrder: 0,
  isCustom: false,
  isActive: true,
  requiresDeposit: false,
  depositAmountCents: null,
  paymentPolicy: null,
  depositBasis: null,
  depositPercent: null,
  depositLink: null,
  stripePaymentLinkId: null,
  stripeProductId: null,
  painPoints: null,
  expectedResults: null,
  processDescription: null,
  targetArea: null,
  priceText: '€50.00',
  priceType: 'fixed',
  priceCents: 5000,
  taxCode: null,
  appointmentDuration: 60,
  turnaroundMinutes: null,
  regions: [],
  specSource: 'unknown' as const,
  techniqueSlug: null,
  techniqueClassifiedAt: null,
  expectedShotEmbedding: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
});

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

describe('EditServiceDialog', () => {
  beforeEach(() => {
    put.mockResolvedValue({ id: 'svc1' });
    get.mockResolvedValue([]);
  });

  /**
   * Give the org one room category with two rooms, and the service a saved
   * requirement narrowed to Room 2 with a 15-minute turnaround.
   */
  const withSavedRequirements = (
    requirements: unknown[] = [
      {
        categoryId: 'cat-rooms',
        categoryName: 'Treatment rooms',
        categoryKind: 'room',
        eligibleResourceIds: ['res-2'],
      },
    ],
    turnaroundMinutes: number | null = 15
  ) => {
    get.mockImplementation((path: string) => {
      // Most specific first: requirements, then categories, then the list.
      if (path.startsWith('resources/requirements')) {
        return Promise.resolve({
          serviceId: 'svc1',
          turnaroundMinutes,
          requirements,
        });
      }
      if (path.startsWith('resources/categories')) {
        return Promise.resolve([ROOM_CATEGORY]);
      }
      if (path.startsWith('resources')) return Promise.resolve(ROOMS);
      return Promise.resolve([]);
    });
  };

  const gotoPricingStep = async (user: ReturnType<typeof userEvent.setup>) => {
    await screen.findByDisplayValue('Haircut');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: '2. Pricing and Duration' });
  };

  const requirementsCall = () =>
    put.mock.calls.find((c) => c[0] === 'resources/requirements/svc1');

  // The hydration effect depends on the practitioners array; while that query
  // is pending the hook returns a fresh `[]` each render, which would loop the
  // effect. Seed the cache so both reads resolve on the first render.
  function seededClient() {
    const client = createTestQueryClient();
    client.setQueryData(['practitioners', 'list', {}], { items: [] });
    client.setQueryData(['service-categories', 'list'], []);
    // Deposit toggle is gated on an active Stripe Connect — seed one so the
    // deposit field is reachable in these tests.
    client.setQueryData(['integrations', 'stripe'], {
      isActive: true,
      chargesEnabled: true,
    });
    return client;
  }
  const render = (ui: ReactElement) =>
    renderWithProviders(ui, { queryClient: seededClient() });

  it('hydrates the saved service name on step 1', async () => {
    render(
      <EditServiceDialog open onOpenChange={() => {}} service={service} />
    );
    expect(
      screen.getByRole('heading', { name: '1. Basic Details' })
    ).toBeVisible();
    expect(await screen.findByDisplayValue('Haircut')).toBeVisible();
  });

  it('persists the renamed service via PUT', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <EditServiceDialog open onOpenChange={onOpenChange} service={service} />
    );

    const name = await screen.findByDisplayValue('Haircut');
    await user.clear(name);
    await user.type(name, 'Haircut RENAMED');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith(
      'organization-services/svc1',
      expect.objectContaining({
        name: 'Haircut RENAMED',
        appointmentDuration: 60,
        // Structured price now, derived from the hydrated priceCents (5000).
        priceCents: 5000,
      })
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  // ── Rooms & equipment ─────────────────────────────────────────────────────

  it('hydrates the saved requirement and turnaround', async () => {
    withSavedRequirements();
    const user = userEvent.setup();
    render(
      <EditServiceDialog open onOpenChange={() => {}} service={service} />
    );

    await gotoPricingStep(user);

    expect(
      await screen.findByRole('switch', { name: /requires a room/i })
    ).toBeChecked();
    // Narrowed to Room 2 — so "Any room" is off.
    expect(await screen.findByLabelText('Room 2')).toBeChecked();
    expect(screen.getByLabelText('Room 1')).not.toBeChecked();
    expect(screen.getByLabelText('Any room')).not.toBeChecked();
    expect(screen.getByLabelText('Turnaround time')).toHaveValue(15);
  });

  it('leaves an unchanged requirement set alone on save', async () => {
    // The PUT REPLACES the whole set; re-writing an identical one on every
    // service save is pure noise (and an extra way to lose data).
    withSavedRequirements();
    const user = userEvent.setup();
    render(
      <EditServiceDialog open onOpenChange={() => {}} service={service} />
    );

    await gotoPricingStep(user);
    await screen.findByLabelText('Room 2');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        'organization-services/svc1',
        expect.anything()
      )
    );
    expect(requirementsCall()).toBeUndefined();
  });

  it('replaces the set with an empty eligible list when widened to "Any room"', async () => {
    withSavedRequirements();
    const user = userEvent.setup();
    render(
      <EditServiceDialog open onOpenChange={() => {}} service={service} />
    );

    await gotoPricingStep(user);
    await user.click(await screen.findByLabelText('Any room'));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(requirementsCall()).toBeDefined());
    expect(requirementsCall()?.[1]).toEqual({
      turnaroundMinutes: 15,
      // EMPTY = every room in the category qualifies.
      requirements: [{ categoryId: 'cat-rooms', eligibleResourceIds: [] }],
    });
  });

  it('sends null when a saved turnaround is stepped back down to 0', async () => {
    withSavedRequirements(undefined, 5);
    const user = userEvent.setup();
    render(
      <EditServiceDialog open onOpenChange={() => {}} service={service} />
    );

    await gotoPricingStep(user);
    expect(await screen.findByLabelText('Turnaround time')).toHaveValue(5);

    await user.click(
      screen.getByRole('button', { name: 'Decrease turnaround time' })
    );
    expect(screen.getByLabelText('Turnaround time')).toHaveValue(0);

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(requirementsCall()).toBeDefined());
    expect(requirementsCall()?.[1]).toMatchObject({ turnaroundMinutes: null });
  });

  it('drops the requirement entirely when the switch is turned off', async () => {
    withSavedRequirements();
    const user = userEvent.setup();
    render(
      <EditServiceDialog open onOpenChange={() => {}} service={service} />
    );

    await gotoPricingStep(user);
    await user.click(
      await screen.findByRole('switch', { name: /requires a room/i })
    );
    expect(screen.queryByLabelText('Any room')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(requirementsCall()).toBeDefined());
    expect(requirementsCall()?.[1]).toMatchObject({ requirements: [] });
  });

  it('keeps the dialog open and toasts when the update fails', async () => {
    put.mockRejectedValueOnce(new Error('update boom'));
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <EditServiceDialog open onOpenChange={onOpenChange} service={service} />
    );

    await screen.findByDisplayValue('Haircut');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('update boom')
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
