import { renderWithProviders, screen, waitFor } from '@/test/render';
import type { ProductBrand } from '@borradh-workspace/api-client/types';
import { fixture, productBrandSchema } from '@borradh-workspace/contracts';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Covers the list-render + delete-via-row-menu half of the E2E
// catalog/brands.spec.ts (the create/edit dialog is covered in
// product-brand-dialog.test.tsx).
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

import { ProductBrandsPage } from './product-brands-page';

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

const brands: ProductBrand[] = [
  fixture(productBrandSchema, {
    id: 'b1',
    organizationId: 'org_1',
    name: 'Kerastase',
    description: 'Premium',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }),
  fixture(productBrandSchema, {
    id: 'b2',
    organizationId: 'org_1',
    name: 'Olaplex',
    description: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }),
];

describe('ProductBrandsPage', () => {
  beforeEach(() => {
    del.mockResolvedValue({ success: true });
    get.mockResolvedValue(brands);
  });

  it('renders a row per brand', async () => {
    renderWithProviders(<ProductBrandsPage />);
    expect(await screen.findByText('Kerastase')).toBeVisible();
    expect(screen.getByText('Olaplex')).toBeVisible();
  });

  it('shows the empty state when there are no brands', async () => {
    get.mockResolvedValueOnce([]);
    renderWithProviders(<ProductBrandsPage />);
    expect(await screen.findByText('No brands yet')).toBeVisible();
  });

  it('deletes a brand through the row menu + confirm dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProductBrandsPage />);
    await screen.findByText('Kerastase');

    await user.click(
      screen.getByRole('button', { name: 'Actions for Kerastase' })
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Kerastase');
    await user.click(
      screen.getByRole('button', { name: 'Delete', hidden: false })
    );

    await waitFor(() => expect(del).toHaveBeenCalledWith('product-brands/b1'));
  });
});
