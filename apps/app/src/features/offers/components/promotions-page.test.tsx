import { renderWithProviders, screen, waitFor } from '@/test/render';
import type { Offer } from '@borradh-workspace/api-client/types';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Covers the E2E catalog/offers.spec.ts row-persistence assertion: a
// percentage promotion renders its discount as "15%" in the table. Also
// exercises the row delete action. Create is covered in
// offer-form-dialog.test.tsx.
const get = vi.fn();
const del = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  // `useActiveLocation` reads the branch out of the PATHNAME (see
  // test/render.tsx) — the page pulls it in for the "import from another
  // location" caret, so the router mock has to answer it.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/catalog' } }),
  useNavigate: () => vi.fn(),
}));

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

import { PromotionsPage } from './promotions-page';

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

const offers = [
  {
    id: 'o1',
    name: 'Xmas Sale',
    code: null,
    state: 'active',
    discountType: 'percentage',
    discountPercent: 15,
    discountAmountCents: null,
    redemptionCount: 0,
    redemptionLimit: null,
    validFrom: null,
    validUntil: null,
    serviceIds: [],
    locationIds: [],
  },
] as unknown as (Offer & { serviceIds: string[]; locationIds: string[] })[];

describe('PromotionsPage', () => {
  beforeEach(() => {
    del.mockResolvedValue(undefined);
    get.mockImplementation((path: string) => {
      if (path.startsWith('offers'))
        return Promise.resolve({ items: offers, total: offers.length });
      // services + locations both read `{ items }`.
      return Promise.resolve({ items: [] });
    });
  });

  it('renders a percentage promotion row showing "15%"', async () => {
    renderWithProviders(<PromotionsPage />);
    const row = await screen.findByRole('row', { name: /Xmas Sale/ });
    expect(row).toHaveTextContent('15%');
  });

  it('deletes a promotion via the row action menu, behind a confirmation', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PromotionsPage />);
    await screen.findByText('Xmas Sale');

    await user.click(screen.getByRole('button', { name: 'Row actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    // The menu item used to fire the DELETE directly — no confirmation on a
    // destructive, cross-branch action. It now opens the shared dialog.
    expect(del).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: /^Delete/ }));

    await waitFor(() => expect(del).toHaveBeenCalledWith('offers/o1'));
  });
});
