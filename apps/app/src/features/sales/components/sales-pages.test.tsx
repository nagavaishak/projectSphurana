import { renderWithProviders, screen } from '@/test/render';
import {
  fixture,
  saleDailySummarySchema,
  saleWithRelationsSchema,
} from '@borradh-workspace/contracts';
import type { ComponentType, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The sales pages read their data through the sales/appointments hooks →
// apiClient.get. Route by URL so each resolves the right empty shape.
const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// These pages are `createFileRoute` files. Replace the router primitives with
// test doubles: `createFileRoute` returns a factory that just captures options
// (so `Route.options.component` is the page component), and Link/useNavigate are
// stubbed so no RouterProvider is needed.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: { component: ComponentType }) => ({
    options: opts,
  }),
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => vi.fn(),
  // Branch-scoped hrefs are read from the pathname (plan §4); see
  // `src/test/render.tsx` for why a router-coupled spec must mock this.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/customers' } }),
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

import { Route as AppointmentsRoute } from '@/routes/_authed/dashboard/l/$locationId/sales/appointments';
import { Route as DailySummaryRoute } from '@/routes/_authed/dashboard/l/$locationId/sales/daily-summary';
import { Route as ListRoute } from '@/routes/_authed/dashboard/l/$locationId/sales/list';
import { Route as MembershipsRoute } from '@/routes/_authed/dashboard/l/$locationId/sales/memberships';
import { Route as ProductOrdersRoute } from '@/routes/_authed/dashboard/l/$locationId/sales/product-orders';

// biome-ignore lint/suspicious/noExplicitAny: test doubles expose options.component.
const pageOf = (route: any): ComponentType => route.options.component;

// Schema-validated so the mock can't drift from the daily-summary contract.
const EMPTY_SUMMARY = fixture(saleDailySummarySchema, {
  date: '2024-01-01',
  currency: 'eur',
  saleCount: 0,
  totalCents: 0,
  tipCents: 0,
  byMethod: {},
  byItemType: {},
  itemRows: {},
  methodRows: {},
});

function defaultGet(url: string) {
  if (url.startsWith('sales/daily-summary')) {
    return Promise.resolve(EMPTY_SUMMARY);
  }
  if (url.startsWith('lead-memberships')) return Promise.resolve([]);
  // sales / appointments list endpoints → empty list.
  return Promise.resolve({ items: [], total: 0 });
}

describe('Sales pages · empty states', () => {
  beforeEach(() => {
    get.mockImplementation((url: string) => defaultGet(url));
  });

  it('Appointments renders its heading and empty state', async () => {
    const Page = pageOf(AppointmentsRoute);
    renderWithProviders(<Page />);

    expect(
      await screen.findByRole('heading', { name: 'Appointments' })
    ).toBeVisible();
    expect(await screen.findByText('No appointments found')).toBeVisible();
  });

  it('Daily summary renders both summary cards for an empty day', async () => {
    const Page = pageOf(DailySummaryRoute);
    renderWithProviders(<Page />);

    expect(
      await screen.findByRole('heading', { name: 'Daily sales' })
    ).toBeVisible();
    expect(await screen.findByText('Transaction summary')).toBeVisible();
    expect(screen.getByText('Cash movement summary')).toBeVisible();
  });

  it('Memberships renders its heading and empty state', async () => {
    const Page = pageOf(MembershipsRoute);
    renderWithProviders(<Page />);

    expect(
      await screen.findByRole('heading', { name: 'Membership sales' })
    ).toBeVisible();
    expect(await screen.findByText('No memberships created yet')).toBeVisible();
  });

  it('Product orders renders its heading and store-not-set-up empty state', async () => {
    const Page = pageOf(ProductOrdersRoute);
    renderWithProviders(<Page />);

    expect(
      await screen.findByRole('heading', { name: 'Product orders' })
    ).toBeVisible();
    expect(
      await screen.findByText(
        /Online store is not yet set up|No product orders yet/
      )
    ).toBeVisible();
  });

  it('Sales list renders its heading and empty state', async () => {
    const Page = pageOf(ListRoute);
    renderWithProviders(<Page />);

    expect(await screen.findByRole('heading', { name: 'Sales' })).toBeVisible();
    expect(await screen.findByText('No sales yet')).toBeVisible();
  });

  it('Sales list renders a seeded completed sale row', async () => {
    // Schema-validated against the sale-with-relations contract (strict).
    const sale = fixture(saleWithRelationsSchema, {
      id: 'sale-1',
      organizationId: 'org-1',
      leadId: 'lead-1',
      locationId: null,
      status: 'completed',
      subtotalCents: 5000,
      tipType: 'none',
      tipPercent: null,
      tipCents: 0,
      totalCents: 5000,
      currency: 'USD',
      stripeTaxCalculationId: null,
      fulfilmentMethod: null,
      fulfilmentStatus: 'not_applicable',
      collectedAt: null,
      collectedById: null,
      trackingReference: null,
      shopCartId: null,
      shopCheckoutSessionId: null,
      customerEmail: null,
      orderAccessToken: null,
      orderConfirmedAt: null,
      readyNotificationSentAt: null,
      createdById: 'user-1',
      completedAt: '2024-01-01T10:00:00.000Z',
      createdAt: '2024-01-01T10:00:00.000Z',
      updatedAt: '2024-01-01T10:00:00.000Z',
      lead: {
        id: 'lead-1',
        firstName: 'Nadia',
        lastName: 'Sale',
        email: null,
        phone: null,
      },
      items: [
        {
          id: 'i1',
          saleId: 'sale-1',
          itemType: 'gift_card',
          appointmentId: null,
          serviceId: null,
          productId: null,
          membershipPlanId: null,
          giftCardId: null,
          practitionerId: null,
          name: 'Gift card',
          quantity: 1,
          unitPriceCents: 5000,
          totalCents: 5000,
          vatRateBps: 0,
          vatAmountCents: 0,
          giftCardFaceValueCents: null,
          giftCardExpiry: null,
          createdAt: '2024-01-01T10:00:00.000Z',
          updatedAt: '2024-01-01T10:00:00.000Z',
        },
      ],
      payments: [],
    });
    get.mockImplementation((url: string) => {
      if (url.startsWith('sales?') || url === 'sales') {
        return Promise.resolve({ items: [sale], total: 1 });
      }
      return defaultGet(url);
    });

    const Page = pageOf(ListRoute);
    renderWithProviders(<Page />);

    expect(await screen.findByText('Nadia Sale')).toBeVisible();
  });
});
