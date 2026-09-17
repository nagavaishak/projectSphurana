import { renderWithProviders, screen, waitFor } from '@/test/render';
import type {
  Product,
  ProductBrand,
} from '@borradh-workspace/api-client/types';
import {
  fixture,
  productBrandSchema,
  productSchema,
} from '@borradh-workspace/contracts';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// List-render + delete half of the E2E catalog/products.spec.ts (the row shows
// the name + its brand). The create/edit form is covered separately in
// product-form-dialog.test.tsx.
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

import { ProductsPage } from './products-page';

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

// Schema-validated so the mocks can't drift from the real API responses.
const brands: ProductBrand[] = [
  fixture(productBrandSchema, {
    id: 'b1',
    organizationId: 'org_1',
    name: 'Kerastase',
    description: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }),
];

const products: Product[] = [
  fixture(productSchema, {
    id: 'prod1',
    organizationId: 'org_1',
    name: 'Argan oil shampoo',
    images: [],
    barcode: null,
    brandId: 'b1',
    measureUnit: 'whole',
    measureAmount: null,
    shortDescription: null,
    description: null,
    categoryId: null,
    supplyPriceCents: null,
    retailEnabled: false,
    isMedication: false,
    onlineEnabled: false,
    shippable: true,
    retailPriceCents: null,
    taxCode: null,
    teamMemberCommissionEnabled: false,
    skus: [],
    supplierId: null,
    trackStock: false,
    lowStockLevel: null,
    reorderQuantity: null,
    lowStockNotify: false,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }),
];

describe('ProductsPage', () => {
  beforeEach(() => {
    del.mockResolvedValue({ id: 'prod1' });
    get.mockImplementation((path: string) => {
      if (path.includes('product-brands')) return Promise.resolve(brands);
      if (path.includes('location')) return Promise.resolve({ items: [] });
      if (path.startsWith('products'))
        return Promise.resolve({ items: products, total: products.length });
      return Promise.resolve([]);
    });
  });

  it('renders the product name and its brand', async () => {
    renderWithProviders(<ProductsPage />);
    expect(await screen.findByText('Argan oil shampoo')).toBeVisible();
    expect(screen.getByText('Kerastase')).toBeVisible();
  });

  it('deletes a product through the row menu + confirm dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProductsPage />);
    await screen.findByText('Argan oil shampoo');

    await user.click(
      screen.getByRole('button', { name: 'Actions for Argan oil shampoo' })
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Argan oil shampoo');
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(del).toHaveBeenCalledWith('products/prod1'));
  });
});
