import { renderWithProviders, screen, waitFor } from '@/test/render';
import type { OrganizationService } from '@borradh-workspace/api-client/types';
import {
  fixture,
  offerWithLinksSchema,
  organizationServiceSchema,
} from '@borradh-workspace/contracts';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors the E2E catalog/offers.spec.ts create-% flow. Unlike the E2E, we
// pre-select the linked service via `defaultServiceIds` so no Command popover
// interaction is needed — the form logic (zod validation + payload building
// + create/update hooks) is exercised directly.
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
import { OfferFormDialog } from './offer-form-dialog';

// Radix Select/Popover browser-API polyfills.
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

// Schema-validated so the mock can't drift from the real service response.
const services: OrganizationService[] = [
  fixture(organizationServiceSchema, {
    id: 'svc1',
    organizationId: 'org_1',
    name: 'Haircut',
    description: null,
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
    priceText: null,
    priceType: 'poa',
    priceCents: null,
    taxCode: null,
    appointmentDuration: null,
    turnaroundMinutes: null,
    regions: [],
    specSource: 'unknown' as const,
    techniqueSlug: null,
    techniqueClassifiedAt: null,
    expectedShotEmbedding: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }),
];

describe('OfferFormDialog', () => {
  beforeEach(() => {
    post.mockResolvedValue({ id: 'new-offer' });
    put.mockResolvedValue({ id: 'o1' });
    get.mockResolvedValue({ items: [] });
  });

  it('renders the promotion name + discount fields (create mode)', () => {
    renderWithProviders(
      <OfferFormDialog
        open
        onOpenChange={() => {}}
        services={services}
        defaultServiceIds={['svc1']}
      />
    );
    expect(
      screen.getByRole('heading', { name: 'Add Promotion' })
    ).toBeVisible();
    expect(screen.getByLabelText('Promotion Name')).toBeVisible();
    // Percentage is the default discount type; its input is "Discount Amount".
    expect(screen.getByLabelText('Discount Amount')).toBeVisible();
  });

  it('shows an inline error and does NOT write when the name is empty', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <OfferFormDialog
        open
        onOpenChange={() => {}}
        services={services}
        defaultServiceIds={['svc1']}
      />
    );

    await user.type(screen.getByLabelText('Discount Amount'), '15');
    await user.click(screen.getByRole('button', { name: 'Add Promotion' }));

    expect(await screen.findByText('Name is required')).toBeVisible();
    expect(post).not.toHaveBeenCalled();
  });

  it('requires at least one linked service when the picker is shown', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <OfferFormDialog open onOpenChange={() => {}} services={services} />
    );

    await user.type(screen.getByLabelText('Promotion Name'), 'Xmas Sale');
    await user.type(screen.getByLabelText('Discount Amount'), '15');
    await user.click(screen.getByRole('button', { name: 'Add Promotion' }));

    expect(
      await screen.findByText('Pick at least one service for this promotion')
    ).toBeVisible();
    expect(post).not.toHaveBeenCalled();
  });

  it('creates a percentage promotion with discountPercent=15 and the linked service', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <OfferFormDialog
        open
        onOpenChange={onOpenChange}
        services={services}
        defaultServiceIds={['svc1']}
      />
    );

    await user.type(screen.getByLabelText('Promotion Name'), 'Xmas Sale');
    await user.type(screen.getByLabelText('Discount Amount'), '15');
    await user.click(screen.getByRole('button', { name: 'Add Promotion' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [path, payload] = post.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(path).toBe('offers');
    expect(payload).toMatchObject({
      name: 'Xmas Sale',
      discountType: 'percentage',
      discountPercent: 15,
      discountAmountCents: null,
      serviceIds: ['svc1'],
      state: 'active',
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('edits an existing percentage offer and PUTs the updated payload', async () => {
    const offer = fixture(offerWithLinksSchema, {
      id: 'o1',
      organizationId: 'org_1',
      name: 'Old Promo',
      description: null,
      code: null,
      state: 'active',
      discountType: 'percentage',
      discountPercent: 10,
      discountAmountCents: null,
      originalPriceCents: null,
      offerPriceCents: null,
      buyQuantity: null,
      getQuantity: null,
      limitPerClient: false,
      redemptionLimit: null,
      redemptionCount: 0,
      validFrom: null,
      validUntil: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      deletedAt: null,
      serviceIds: ['svc1'],
      locationIds: [],
    });

    const user = userEvent.setup();
    renderWithProviders(
      <OfferFormDialog
        open
        onOpenChange={() => {}}
        offer={offer}
        services={services}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Edit Promotion' })
    ).toBeVisible();
    const name = await screen.findByDisplayValue('Old Promo');
    await user.clear(name);
    await user.type(name, 'New Promo');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const [path, payload] = put.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(path).toBe('offers/o1');
    expect(payload).toMatchObject({
      name: 'New Promo',
      discountType: 'percentage',
      discountPercent: 10,
      serviceIds: ['svc1'],
    });
  });

  it('keeps the dialog open and toasts when the server rejects', async () => {
    post.mockRejectedValueOnce(new Error('offer boom'));
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <OfferFormDialog
        open
        onOpenChange={onOpenChange}
        services={services}
        defaultServiceIds={['svc1']}
      />
    );

    await user.type(screen.getByLabelText('Promotion Name'), 'Xmas Sale');
    await user.type(screen.getByLabelText('Discount Amount'), '15');
    await user.click(screen.getByRole('button', { name: 'Add Promotion' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('offer boom'));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
