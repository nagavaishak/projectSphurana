import { renderWithProviders, screen, waitFor } from '@/test/render';
import type { ProductCategory } from '@borradh-workspace/api-client/types';
import { fixture, productCategorySchema } from '@borradh-workspace/contracts';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// List-render + delete half of the E2E catalog/categories.spec.ts.
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

import { ProductCategoriesPage } from './product-categories-page';

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

const categories: ProductCategory[] = [
  fixture(productCategorySchema, {
    id: 'c1',
    organizationId: 'org_1',
    name: 'Shampoo',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }),
];

describe('ProductCategoriesPage', () => {
  beforeEach(() => {
    del.mockResolvedValue({ success: true });
    get.mockResolvedValue(categories);
  });

  it('renders a row per category', async () => {
    renderWithProviders(<ProductCategoriesPage />);
    expect(await screen.findByText('Shampoo')).toBeVisible();
  });

  it('deletes a category through the row menu + confirm dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProductCategoriesPage />);
    await screen.findByText('Shampoo');

    await user.click(
      screen.getByRole('button', { name: 'Actions for Shampoo' })
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Shampoo');
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(del).toHaveBeenCalledWith('product-categories/c1')
    );
  });
});
