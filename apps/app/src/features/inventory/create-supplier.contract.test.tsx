import { createSupplierForm } from '@/features/inventory/api/create-supplier';
import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `POST /suppliers` — create supplier.
 *
 * TWO surfaces, owning different slices:
 *
 *   - {@link SupplierDialog} — the whole form (name + description). Suppliers
 *     KEEP their dialog: two plain fields do not earn a full page.
 *   - the stock-order editor's supplier picker — an inline `Create "…"` row that
 *     `owns: ['name']`. It is a NAME-ONLY quick-create by design: the user types
 *     the name into the combobox's search box, and `buildCreateSupplierPayload`
 *     coalesces the absent description to `null`. That coalesce is pinned in its
 *     expected body, so the quick-create cannot start sending `''` or omitting
 *     the key instead.
 *
 * Property 4 compares the ground they share (`name`), and the ownership check
 * still holds `description` to being reachable on SOME surface.
 */

// Radix Dialog / Popover / cmdk need these in jsdom.
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

vi.mock('@/features/organization-locations', () => ({
  useListLocations: () => ({ locations: [], isLoading: false }),
}));

import { renderEntityEditor } from '@/features/entity-editors/testing/render-entity-editor';
import { SupplierDialog } from './components/supplier-dialog';

const F = createSupplierForm.fields;
const NAME = (F.name as { sample: string }).sample;

runFormContract({
  operation: 'POST suppliers',
  description: 'Create supplier',
  form: createSupplierForm,

  surfaces: [
    {
      name: 'SupplierDialog',
      run: async (ctx) => {
        renderWithProviders(<SupplierDialog open onOpenChange={() => {}} />);
        await screen.findByRole('dialog');
        await ctx.fillRest();
        await ctx.user.click(
          screen.getByRole('button', { name: 'Create supplier' })
        );
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
    {
      name: 'stock-order supplier picker (inline create)',
      owns: ['name'],
      fills: {
        // The quick-create's name control IS the combobox search box: what the
        // user types there is the name the `Create "…"` row creates.
        name: async (user) => {
          const search = await screen.findByPlaceholderText(
            'Search or create supplier…'
          );
          await user.type(search, NAME);
        },
      },
      run: async (ctx) => {
        renderEntityEditor('stock-order');
        await screen.findByRole('heading', { name: /new stock order/i });
        await ctx.user.click(screen.getByLabelText('Supplier'));
        await ctx.fillRest();
        await ctx.user.click(await screen.findByText(`Create "${NAME}"`));
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
  ],

  reset: () => {
    post.mockReset();
    post.mockResolvedValue({ id: 'new-supplier', name: NAME });
    put.mockReset();
    get.mockReset();
    get.mockImplementation((path: string) =>
      path.startsWith('products')
        ? Promise.resolve({ items: [], total: 0, limit: 100, offset: 0 })
        : Promise.resolve([])
    );
  },

  readBody: () => {
    const call = post.mock.calls.find((c) => c[0] === 'suppliers');
    if (!call) throw new Error('no POST suppliers call captured');
    return call[1] as Record<string, unknown>;
  },

  // The dialog sends both fields as typed (the builder only trims). The
  // quick-create sends the name it owns plus the builder's `null` description —
  // spelled out, so a drift to `''` or an omitted key fails here.
  expectedBody: (surface) =>
    expectedFromFields(F, surface.owns ? { description: null } : {}, {
      only: surface.owns,
    }),
});
