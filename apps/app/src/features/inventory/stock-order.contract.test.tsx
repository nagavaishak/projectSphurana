import {
  buildCreateStockOrderPayload,
  createStockOrderForm,
} from '@/features/inventory/api/create-stock-order';
import { runFormContract } from '@/test/form-contract/harness';
import { screen, waitFor, within } from '@/test/render';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `POST /stock-orders` — create a stock order.
 *
 * ONE surface since the create dialog was replaced by the unified entity editor
 * (`/create/stock-order`).
 *
 * Four of the six fields are bespoke controls (the inline-create supplier
 * combobox, the day picker, and the repeating line-item and fee rows), so they
 * are driven by the `fills` overrides below rather than by a generic driver —
 * which still means the harness refuses to let one go unfilled. The
 * derivations this pins are the ones a payload test would otherwise never see:
 * a typed `'12.50'` becomes 1250 cents, and a percent fee becomes BASIS POINTS.
 */

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

const post = vi.fn();
const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => vi.fn()(...a),
    delete: (...a: unknown[]) => vi.fn()(...a),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  Navigate: () => null,
  // Branch-scoped hrefs are read from the pathname (plan §4); see
  // `src/test/render.tsx` for why a router-coupled spec must mock this.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/home' } }),
}));

vi.mock('@/features/organization-locations', () => ({
  useListLocations: () => ({
    locations: [{ id: 'loc_1', name: 'Bray Studio', isPrimary: true }],
    isLoading: false,
  }),
}));

import { renderEntityEditor } from '@/features/entity-editors/testing/render-entity-editor';

const F = createStockOrderForm.fields;
const EXPECTED_BY = (F.expectedByDate as { sample: Date }).sample;

runFormContract({
  operation: 'POST stock-orders',
  description: 'Create stock order',
  form: createStockOrderForm,

  surfaces: [
    {
      name: 'unified entity editor (/create/stock-order)',
      run: async (ctx) => {
        renderEntityEditor('stock-order');
        await screen.findByRole('heading', { name: /new stock order/i });
        await ctx.fillRest();
        await ctx.user.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
  ],

  fills: {
    supplierId: async (user) => {
      await user.click(screen.getByLabelText('Supplier'));
      await user.click(await screen.findByRole('option', { name: /Acme/i }));
    },

    expectedByDate: async (user) => {
      await user.click(screen.getByLabelText('Expected by'));
      // The day picker opens on the current month, so today's cell is always
      // rendered — see `todayAtMidnight` on the form declaration.
      const grid = await screen.findByRole('grid');
      const day = String(EXPECTED_BY.getDate());
      // Skip OUTSIDE days — the leading/trailing cells the grid borrows from
      // the neighbouring months. They carry the same digits, and they come
      // first, so a plain text match silently picks the wrong month on any
      // date where the two collide (26 Aug 2026 landed on exactly that: the
      // grid opens with 26 July in its first row).
      const cell = within(grid)
        .getAllByRole('button')
        .find(
          (button) =>
            button.textContent?.trim() === day &&
            button.closest('[data-outside="true"]') === null &&
            button.dataset.outside !== 'true'
        );
      if (!cell) throw new Error(`no calendar cell for day ${day}`);
      await user.click(cell);
    },

    itemRows: async (user) => {
      // The line's product picker carries no label of its own — the row IS the
      // control — so it is located by the placeholder the user reads.
      const picker = screen.getByText('Select product').closest('button');
      if (!picker) throw new Error('no product picker on the first line');
      await user.click(picker);
      await user.click(await screen.findByRole('option', { name: /Shampoo/i }));

      const quantity = screen.getByLabelText('Quantity');
      await user.clear(quantity);
      await user.type(quantity, '2');
      await user.type(screen.getByLabelText('Unit cost'), '12.50');
    },

    feeRows: async (user) => {
      await user.click(screen.getByRole('button', { name: /add fee/i }));
      await user.type(await screen.findByLabelText('Fee name'), 'Shipping');
      await user.type(screen.getByLabelText('Fee value'), '4.00');
    },
  },

  reset: () => {
    post.mockReset();
    post.mockResolvedValue({ id: 'order_1' });
    get.mockReset();
    get.mockImplementation((path: string) =>
      path.startsWith('products')
        ? Promise.resolve({
            items: [{ id: 'prod_1', name: 'Shampoo 250ml' }],
            total: 1,
            limit: 100,
            offset: 0,
          })
        : Promise.resolve([{ id: 'sup_1', name: 'Acme Supplies' }])
    );
  },

  readBody: () => {
    const call = post.mock.calls.find((c) => c[0] === 'stock-orders');
    if (!call) throw new Error('no POST stock-orders call captured');
    return call[1] as Record<string, unknown>;
  },

  // Spelled out rather than derived from the samples: every value here is a
  // DERIVATION of what was typed (money → cents, quantity → integer), and the
  // point of the assertion is that the derivation happened.
  expectedBody: () => ({
    supplierId: 'sup_1',
    locationId: 'loc_1',
    expectedByDate: EXPECTED_BY,
    notes: 'Rush order',
    items: [{ productId: 'prod_1', quantity: 2, unitCostCents: 1250 }],
    fees: [{ name: 'Shipping', type: 'currency', value: 400 }],
  }),

  buildBody: (values) => buildCreateStockOrderPayload(values),
});
