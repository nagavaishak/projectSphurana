import { renderWithProviders, screen } from '@/test/render';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  // Branch-scoped hrefs are read from the pathname (plan §4); see
  // `src/test/render.tsx` for why a router-coupled spec must mock this.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/home' } }),
}));
import type { ListServicesResponse } from '@borradh-workspace/api-client/types';
import {
  defineFixture,
  fixture,
  listServicesResponseSchema,
  listedServiceSchema,
} from '@borradh-workspace/contracts';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CatalogPickerDialog — searchable picker for the three catalog-backed cart
 * line types (service / product / membership). It reads data through the
 * feature hooks, which call apiClient.get under the hood, so — exactly like
 * client-picker-dialog.test.tsx — we mock apiClient and feed schema-valid
 * contract fixtures through React Query.
 *
 * Money angle: a service carries a structured `priceCents`, and selection sets
 * the cart line's `unitPriceCents` straight from it (no parsing of freeform
 * text). We assert that cents pass-through explicitly.
 */
const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
  },
}));

import { CatalogPickerDialog } from './catalog-picker-dialog';

// A full, schema-valid listed service; tests override only what they read.
const aService = defineFixture(listedServiceSchema, {
  id: 'svc-base',
  organizationId: 'org-1',
  name: 'Base service',
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
  priceType: 'fixed',
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
  hasGraphicMedia: false,
  hasVideoFootage: false,
  variants: [],
  // EMPTY MEANS EVERY BRANCH — the empty-junction convention. Required by the
  // response contract, so a fixture without it fails validation before the
  // dialog ever renders.
  locationIds: [],
});

function servicesResponse(
  items: Array<{
    id: string;
    name?: string;
    priceText?: string | null;
    priceType?: 'fixed' | 'from' | 'free' | 'poa';
    priceCents?: number | null;
  }>
): ListServicesResponse {
  return fixture(listServicesResponseSchema, {
    items: items.map((item) => aService(item)),
    total: items.length,
    limit: items.length,
    offset: 0,
  });
}

// The dialog mounts all three catalog hooks; route each URL to a valid shape
// so only the mode under test has rows.
function route(services: ListServicesResponse) {
  get.mockImplementation((url: string) => {
    if (url.startsWith('organization-services'))
      return Promise.resolve(services);
    if (url.startsWith('products'))
      return Promise.resolve({ items: [], total: 0, limit: 0, offset: 0 });
    if (url.startsWith('membership-plans')) return Promise.resolve([]);
    return Promise.resolve({ items: [], total: 0, limit: 0, offset: 0 });
  });
}

describe('CatalogPickerDialog (service mode)', () => {
  beforeEach(() => {
    get.mockReset();
    route(servicesResponse([]));
  });

  it('lists catalog services by name and price', async () => {
    route(
      servicesResponse([
        { id: 's1', name: 'Deep Tissue Massage', priceText: '€50.00' },
        { id: 's2', name: 'Express Facial', priceText: '€35' },
      ])
    );

    renderWithProviders(
      <CatalogPickerDialog
        mode="service"
        open
        onOpenChange={() => {}}
        currency="eur"
        onSelect={() => {}}
      />
    );

    expect(await screen.findByText('Deep Tissue Massage')).toBeVisible();
    expect(await screen.findByText('Express Facial')).toBeVisible();
  });

  it('emits an AddSaleItemInput with the structured priceCents on select', async () => {
    route(
      servicesResponse([
        {
          id: 's9',
          name: 'Deep Tissue Massage',
          priceType: 'fixed',
          priceCents: 5000,
        },
      ])
    );
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <CatalogPickerDialog
        mode="service"
        open
        onOpenChange={onOpenChange}
        currency="eur"
        onSelect={onSelect}
      />
    );

    await user.click(await screen.findByText('Deep Tissue Massage'));

    // "€50.00" → 5000 cents, tagged as a service line referencing the row id.
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({
      itemType: 'service',
      serviceId: 's9',
      name: 'Deep Tissue Massage',
      quantity: 1,
      unitPriceCents: 5000,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('filters the list by the search box', async () => {
    route(
      servicesResponse([
        { id: 's1', name: 'Deep Tissue Massage', priceText: '€50' },
        { id: 's2', name: 'Express Facial', priceText: '€35' },
      ])
    );
    const user = userEvent.setup();

    renderWithProviders(
      <CatalogPickerDialog
        mode="service"
        open
        onOpenChange={() => {}}
        currency="eur"
        onSelect={() => {}}
      />
    );

    await screen.findByText('Deep Tissue Massage');
    await user.type(screen.getByPlaceholderText('Search…'), 'facial');

    expect(screen.queryByText('Deep Tissue Massage')).not.toBeInTheDocument();
    expect(screen.getByText('Express Facial')).toBeVisible();
  });
});
