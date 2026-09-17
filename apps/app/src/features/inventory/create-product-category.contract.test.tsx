import { createProductCategoryForm } from '@/features/inventory/api/create-product-category';
import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `POST /product-categories` — create category.
 *
 * TWO surfaces, and a category is a name and nothing else, so BOTH own the whole
 * body and property 4 compares it whole:
 *
 *   - {@link ProductCategoryDialog} — the labelled "Name" input.
 *   - the product form's category picker — the inline `Create "…"` row, whose
 *     name control is the combobox's own search box.
 *
 * The same field, two genuinely different controls: each surface brings its own
 * `fills.name`, and both still LOCATE a real control and throw when it is gone,
 * which is what property 2 rests on.
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
import { ProductCategoryDialog } from './components/product-category-dialog';

const L = createProductCategoryForm.labels;
const F = createProductCategoryForm.fields;
const NAME = (F.name as { sample: string }).sample;

runFormContract({
  operation: 'POST product-categories',
  description: 'Create product category',
  form: createProductCategoryForm,

  surfaces: [
    {
      name: 'ProductCategoryDialog',
      fills: {
        name: async (user) => {
          await user.type(screen.getByLabelText(L.name), NAME);
        },
      },
      run: async (ctx) => {
        renderWithProviders(
          <ProductCategoryDialog open onOpenChange={() => {}} />
        );
        await screen.findByRole('dialog');
        await ctx.fillRest();
        await ctx.user.click(
          screen.getByRole('button', { name: 'Create category' })
        );
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
    {
      name: 'product-editor category picker (inline create)',
      fills: {
        // The picker's name control IS its search box: what the user types there
        // is the name the inline `Create "…"` row creates.
        name: async (user) => {
          const search = await screen.findByPlaceholderText(
            'Search or create category…'
          );
          await user.type(search, NAME);
        },
      },
      run: async (ctx) => {
        renderEntityEditor('product');
        await screen.findByRole('heading', { name: /add product/i });
        await ctx.user.click(screen.getByLabelText('Category'));
        await ctx.fillRest();
        await ctx.user.click(await screen.findByText(`Create "${NAME}"`));
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
  ],

  reset: () => {
    post.mockReset();
    post.mockResolvedValue({ id: 'new-category', name: NAME });
    put.mockReset();
    get.mockReset();
    get.mockImplementation((path: string) =>
      path.startsWith('products')
        ? Promise.resolve({ items: [], total: 0, limit: 100, offset: 0 })
        : Promise.resolve([])
    );
  },

  readBody: () => {
    const call = post.mock.calls.find((c) => c[0] === 'product-categories');
    if (!call) throw new Error('no POST product-categories call captured');
    return call[1] as Record<string, unknown>;
  },

  expectedBody: () => expectedFromFields(F),
});
