import {
  buildProductWritePayload,
  createProductForm,
} from '@/features/inventory/api/create-product';
import { runFormContract } from '@/test/form-contract/harness';
import { screen, waitFor } from '@/test/render';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `POST /products` — create a product.
 *
 * ONE surface since the create/edit dialog was replaced by the unified entity
 * editor (`/create/product`, `/edit/product/:id`). Both verbs build the SAME
 * body through `buildProductWritePayload`, so pinning the create body pins the
 * update body too — see the builder's note on why the create contract is the
 * tighter of the pair.
 *
 * This is the entity where property 3 does the most work: almost every field is
 * DERIVED on its way to the wire — `'10.00'` → `1000` cents, `'250'` → `250`,
 * `'5'` → `5` — and commission and the stock fields are gated on the toggles
 * above them. A rendering test cannot see any of that.
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

import {
  renderEntityEditor,
  switchSection,
} from '@/features/entity-editors/testing/render-entity-editor';

runFormContract({
  operation: 'POST products',
  description: 'Create product',
  form: createProductForm,

  surfaces: [
    {
      name: 'unified entity editor (/create/product, /edit/product/:id)',
      run: async (ctx) => {
        renderEntityEditor('product');
        await screen.findByRole('heading', { name: /add product/i });

        // The editor is four tabs (Details / Pricing / Identifiers / Stock),
        // so walk them in declaration order — a field on an unvisited tab has
        // no reachable control, which is exactly what property 2 asserts.
        await ctx.fill(
          'name',
          'description',
          'brandId',
          'measureUnit',
          'measureAmount',
          'barcode',
          'categoryId',
          'images'
        );

        await switchSection(ctx.user, 'Pricing');
        await ctx.fill(
          'supplyRaw',
          // Declared BEFORE retail: turning Medication ON clears retail and
          // collapses the section, so it has to be settled first.
          'isMedication',
          'retailEnabled',
          // Inside the Retail section, which only exists once retail is on.
          'onlineEnabled',
          'shippable',
          'retailRaw',
          'teamMemberCommissionEnabled',
          'taxCode'
        );

        await switchSection(ctx.user, 'Identifiers');
        await ctx.fill('skus', 'supplierId');

        // `trackStock` walks to the Stock tab itself (see `fills` below).
        await ctx.fillRest();
        await ctx.user.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
  ],

  fills: {
    // The uploader is a dropzone in the editor's ASIDE. A generic driver cannot
    // operate it, but reachability still has to mean something — so assert the
    // control is on screen and leave the list empty, which the expected body
    // then requires.
    images: async () => {
      await screen.findByText(createProductForm.labels.images);
    },

    // The default is a real user choice: let Stripe use the clinic preset.
    // Seeing the labelled picker proves the control remains reachable.
    taxCode: async () => {
      await screen.findByLabelText(createProductForm.labels.taxCode);
    },

    // Stock lives in the editor's last tab, so walk there first. Every field
    // declared after this one is behind the same nav click.
    trackStock: async (user) => {
      await switchSection(user, 'Stock');
      await user.click(await screen.findByLabelText('Track stock'));
    },
  },

  reset: () => {
    post.mockReset();
    post.mockResolvedValue({ id: 'prod_1' });
    get.mockReset();
    get.mockImplementation((path: string) => {
      if (path.startsWith('product-brands')) {
        return Promise.resolve([{ id: 'brand_1', name: 'Olaplex' }]);
      }
      if (path.startsWith('product-categories')) {
        return Promise.resolve([{ id: 'cat_1', name: 'Haircare' }]);
      }
      if (path.startsWith('suppliers')) {
        return Promise.resolve([{ id: 'sup_1', name: 'Acme Supplies' }]);
      }
      if (path.startsWith('products')) {
        return Promise.resolve({ items: [], total: 0, limit: 100, offset: 0 });
      }
      return Promise.resolve([]);
    });
  },

  readBody: () => {
    const call = post.mock.calls.find((c) => c[0] === 'products');
    if (!call) throw new Error('no POST products call captured');
    return call[1] as Record<string, unknown>;
  },

  // Spelled out: nearly every value here is a DERIVATION of what was typed, and
  // the derivation is the thing being asserted.
  expectedBody: () => ({
    name: 'Argan oil shampoo',
    images: [],
    barcode: 'BAR123',
    brandId: 'brand_1',
    measureUnit: 'ml',
    measureAmount: 250,
    description: 'Sulphate-free cleansing shampoo',
    categoryId: 'cat_1',
    supplyPriceCents: 1000,
    retailEnabled: true,
    // Sample is false, so retail survives and online is reachable.
    isMedication: false,
    onlineEnabled: false,
    shippable: true,
    retailPriceCents: 2500,
    taxCode: null,
    teamMemberCommissionEnabled: true,
    skus: ['SHAMPOO-001'],
    supplierId: 'sup_1',
    trackStock: true,
    lowStockLevel: 5,
    reorderQuantity: 20,
    lowStockNotify: true,
  }),

  buildBody: (values) => buildProductWritePayload(values),
});
