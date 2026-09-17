import { createStockTakeForm } from '@/features/inventory/api/create-stock-take';
import { buildCreateStockTakePayload } from '@/features/inventory/api/create-stock-take';
import { runFormContract } from '@/test/form-contract/harness';
import { screen, waitFor } from '@/test/render';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `POST /stock-takes` — start a stocktake.
 *
 * ONE surface since the create dialog was replaced by the unified entity editor
 * (`/create/stock-take`), which is the point: the operation can no longer drift
 * between a desktop dialog and a mobile sheet, because there is only one.
 *
 * PROPERTY 5 is the one that earns its keep here. Name and description are
 * optional free text, so a user who fills nothing but the location leaves them
 * at `''` — and `''` is a PRESENT value. The builder coalesces them to `null`;
 * this pins that, so "unnamed count" can never start persisting as a name of
 * the empty string.
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

const F = createStockTakeForm.fields;

runFormContract({
  operation: 'POST stock-takes',
  description: 'Start stocktake',
  form: createStockTakeForm,

  surfaces: [
    {
      name: 'unified entity editor (/create/stock-take)',
      run: async (ctx) => {
        renderEntityEditor('stock-take');
        await screen.findByRole('heading', { name: /new stocktake/i });
        await ctx.fillRest();
        await ctx.user.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
  ],

  reset: () => {
    post.mockReset();
    post.mockResolvedValue({ id: 'take_1' });
    get.mockReset();
    get.mockResolvedValue([]);
  },

  readBody: () => {
    const call = post.mock.calls.find((c) => c[0] === 'stock-takes');
    if (!call) throw new Error('no POST stock-takes call captured');
    return call[1] as Record<string, unknown>;
  },

  expectedBody: () => ({
    locationId: (F.locationId as { sample: string }).sample,
    name: (F.name as { sample: string }).sample,
    description: (F.description as { sample: string }).sample,
  }),

  buildBody: (values) => buildCreateStockTakePayload(values),
});
