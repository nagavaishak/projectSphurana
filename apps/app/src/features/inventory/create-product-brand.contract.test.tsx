import { createProductBrandForm } from '@/features/inventory/api/create-product-brand';
import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `POST /product-brands` — create brand.
 *
 * TWO surfaces, owning different slices:
 *
 *   - {@link ProductBrandDialog} — the whole form (name + description).
 *   - the product form's brand picker — an inline `Create "…"` row that
 *     `owns: ['name']`. A NAME-ONLY quick-create by design: the name is typed
 *     into the combobox's search box, and `buildCreateProductBrandPayload`
 *     coalesces the absent description to `null` — pinned in its expected body.
 *
 * Property 4 compares the ground they share (`name`); the ownership check still
 * holds `description` to being reachable on SOME surface.
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
const put = vi.fn();
const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
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

import { renderEntityEditor } from '@/features/entity-editors/testing/render-entity-editor';
import { ProductBrandDialog } from './components/product-brand-dialog';

const F = createProductBrandForm.fields;
const NAME = (F.name as { sample: string }).sample;

runFormContract({
  operation: 'POST product-brands',
  description: 'Create product brand',
  form: createProductBrandForm,

  surfaces: [
    {
      name: 'ProductBrandDialog',
      run: async (ctx) => {
        renderWithProviders(
          <ProductBrandDialog open onOpenChange={() => {}} />
        );
        await screen.findByRole('dialog');
        await ctx.fillRest();
        await ctx.user.click(
          screen.getByRole('button', { name: 'Create brand' })
        );
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
    {
      name: 'product-editor brand picker (inline create)',
      owns: ['name'],
      fills: {
        name: async (user) => {
          const search = await screen.findByPlaceholderText(
            'Search or create brand…'
          );
          await user.type(search, NAME);
        },
      },
      run: async (ctx) => {
        renderEntityEditor('product');
        await screen.findByRole('heading', { name: /add product/i });
        await ctx.user.click(screen.getByLabelText('Brand'));
        await ctx.fillRest();
        await ctx.user.click(await screen.findByText(`Create "${NAME}"`));
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
  ],

  reset: () => {
    post.mockReset();
    post.mockResolvedValue({ id: 'new-brand', name: NAME });
    put.mockReset();
    get.mockReset();
    get.mockImplementation((path: string) =>
      path.startsWith('products')
        ? Promise.resolve({ items: [], total: 0, limit: 100, offset: 0 })
        : Promise.resolve([])
    );
  },

  readBody: () => {
    const call = post.mock.calls.find((c) => c[0] === 'product-brands');
    if (!call) throw new Error('no POST product-brands call captured');
    return call[1] as Record<string, unknown>;
  },

  expectedBody: (surface) =>
    expectedFromFields(F, surface.owns ? { description: null } : {}, {
      only: surface.owns,
    }),
});
