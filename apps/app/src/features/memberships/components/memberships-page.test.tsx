import { renderWithProviders, screen, waitFor } from '@/test/render';
import type { MembershipPlanWithServices } from '@borradh-workspace/api-client/types';
import {
  fixture,
  membershipPlanWithServicesSchema,
} from '@borradh-workspace/contracts';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// List-render + delete half of the E2E catalog/memberships.spec.ts (the row
// reflects the session count entered on create).
const get = vi.fn();
const del = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (..._a: unknown[]) => vi.fn(),
    put: (..._a: unknown[]) => vi.fn(),
    delete: (...a: unknown[]) => del(...a),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// The page navigates to the unified editor routes for create/edit.
const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  // `useActiveLocation` reads the branch out of the PATHNAME (see
  // test/render.tsx) — the page pulls it in for the "import from another
  // location" caret, so the router mock has to answer it.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/catalog' } }),
}));

import { MembershipsPage } from './memberships-page';

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

const plans: MembershipPlanWithServices[] = [
  fixture(membershipPlanWithServicesSchema, {
    id: 'p1',
    organizationId: 'org_1',
    name: 'Gold membership',
    description: null,
    serviceIds: [],
    sessionCount: 8,
    pricingType: 'one_time',
    validFor: '1m',
    priceCents: 12000,
    currency: 'eur',
    stripeProductId: null,
    stripePriceId: null,
    isActive: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }),
];

describe('MembershipsPage', () => {
  beforeEach(() => {
    del.mockResolvedValue({ deactivated: false });
    get.mockImplementation((path: string) =>
      path.includes('location')
        ? Promise.resolve({ items: [] })
        : Promise.resolve(plans)
    );
  });

  it('renders a plan row reflecting the session count', async () => {
    renderWithProviders(<MembershipsPage />);
    const row = await screen.findByRole('row', { name: /Gold membership/ });
    expect(row).toHaveTextContent('8');
  });

  it('deletes a plan through the row menu + confirm dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MembershipsPage />);
    await screen.findByText('Gold membership');

    await user.click(
      screen.getByRole('button', { name: 'Actions for Gold membership' })
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Gold membership');
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(del).toHaveBeenCalledWith('membership-plans/p1')
    );
  });
});
