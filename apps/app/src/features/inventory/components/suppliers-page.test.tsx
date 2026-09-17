import { renderWithProviders, screen, waitFor } from '@/test/render';
import type { Supplier } from '@borradh-workspace/api-client/types';
import { fixture, supplierSchema } from '@borradh-workspace/contracts';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// List-render + delete half of the E2E catalog/suppliers.spec.ts.
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

import { SuppliersPage } from './suppliers-page';

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

const suppliers: Supplier[] = [
  fixture(supplierSchema, {
    id: 's1',
    organizationId: 'org_1',
    name: 'Salon Supplies Co.',
    description: 'Wholesale',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }),
];

describe('SuppliersPage', () => {
  beforeEach(() => {
    del.mockResolvedValue({ success: true });
    get.mockResolvedValue(suppliers);
  });

  it('renders a row per supplier', async () => {
    renderWithProviders(<SuppliersPage />);
    expect(await screen.findByText('Salon Supplies Co.')).toBeVisible();
  });

  it('deletes a supplier through the row menu + confirm dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SuppliersPage />);
    await screen.findByText('Salon Supplies Co.');

    await user.click(
      screen.getByRole('button', { name: 'Actions for Salon Supplies Co.' })
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Salon Supplies Co.');
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(del).toHaveBeenCalledWith('suppliers/s1'));
  });
});
