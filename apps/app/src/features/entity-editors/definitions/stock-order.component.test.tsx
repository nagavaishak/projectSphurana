import { describe, expect, it, vi } from 'vitest';

/**
 * COMPONENT TEST: the `stock-order` entity editor.
 *
 * Tier 1. The interesting part of this editor is the repeating line-item and
 * fee rows, which came across from the dialog as `kind: 'custom'` fields — so
 * this checks they render, add and remove. The wire body (quantities parsed,
 * percent fees as basis points) is the contract's job.
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

const navigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
  Navigate: () => null,
  // These specs stand up no RouterProvider (see `render-entity-editor.tsx`),
  // and the real `useRouterState` reads a router off context — so every editor
  // that resolves branch-scoped paths through `useRoutes()` crashes without
  // this. An org-level pathname is the honest answer: the editors are reached
  // from both branch and org routes.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard' } }),
}));

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: vi
      .fn()
      .mockImplementation((path: string) =>
        path.startsWith('products')
          ? Promise.resolve({ items: [], total: 0, limit: 100, offset: 0 })
          : Promise.resolve([])
      ),
    post: vi.fn().mockResolvedValue({ id: 'order_1' }),
    put: vi.fn().mockResolvedValue({ id: 'order_1' }),
    delete: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('@/features/organization-locations', () => ({
  // `useResolvedRoutes` reads the remembered branch synchronously when the URL
  // carries none, so a mock of this module has to answer it.
  readRememberedLocationHandle: () => null,
  useListLocations: () => ({
    locations: [{ id: 'loc_1', name: 'Bray Studio', isPrimary: true }],
    isLoading: false,
  }),
}));

import {
  expectEditorChrome,
  renderEntityEditor,
  screen,
} from '../testing/render-entity-editor';

describe('stock-order entity editor', () => {
  it('renders the shared chrome', async () => {
    renderEntityEditor('stock-order');

    await expectEditorChrome({ title: /new stock order/i });
  });

  it('shows the order fields and one blank line item', async () => {
    renderEntityEditor('stock-order');

    expect(await screen.findByLabelText('Supplier')).toBeInTheDocument();
    expect(screen.getByLabelText('Deliver to')).toBeInTheDocument();
    expect(screen.getByLabelText('Expected by')).toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Quantity')).toHaveLength(1);
  });

  it('adds and removes line items', async () => {
    const { user } = renderEntityEditor('stock-order');
    await screen.findByLabelText('Supplier');

    await user.click(screen.getByRole('button', { name: /add product/i }));
    expect(screen.getAllByLabelText('Quantity')).toHaveLength(2);

    await user.click(screen.getAllByRole('button', { name: 'Remove line' })[0]);
    expect(screen.getAllByLabelText('Quantity')).toHaveLength(1);
  });

  it('adds a fee row', async () => {
    const { user } = renderEntityEditor('stock-order');
    await screen.findByLabelText('Supplier');

    expect(screen.queryByLabelText('Fee name')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /add fee/i }));

    expect(screen.getByLabelText('Fee name')).toBeInTheDocument();
  });

  it('accepts input into a declared field', async () => {
    const { user } = renderEntityEditor('stock-order');

    const notes = await screen.findByLabelText('Notes');
    await user.type(notes, 'Rush order');

    expect(notes).toHaveValue('Rush order');
  });

  it('leaves the editor when cancelled', async () => {
    const { user } = renderEntityEditor('stock-order');
    await screen.findByLabelText('Notes');

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(navigate).toHaveBeenCalled();
  });
});
