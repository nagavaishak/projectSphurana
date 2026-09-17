import { describe, expect, it, vi } from 'vitest';

/**
 * COMPONENT TEST: the `product` entity editor.
 *
 * Tier 1. Products are the one inventory entity with four tabs and an aside, so
 * this covers the split (Details / Pricing / Identifiers / Stock), the
 * conditional blocks the two switches reveal, and the photo uploader in the
 * aside. The create/update body is the contract's job
 * (`product.contract.test.tsx`).
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
    post: vi.fn().mockResolvedValue({ id: 'prod_1' }),
    put: vi.fn().mockResolvedValue({ id: 'prod_1' }),
    delete: vi.fn().mockResolvedValue({}),
  },
}));

import {
  expectEditorChrome,
  renderEntityEditor,
  screen,
  switchSection,
} from '../testing/render-entity-editor';

describe('product entity editor', () => {
  it('renders the shared chrome and all four sections', async () => {
    renderEntityEditor('product');

    await expectEditorChrome({
      title: /add product/i,
      sections: ['Details', 'Pricing', 'Identifiers', 'Stock'],
    });
  });

  it('shows the identity fields on Details', async () => {
    renderEntityEditor('product');

    expect(await screen.findByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByLabelText('Brand')).toBeInTheDocument();
    expect(screen.getByLabelText('Measure')).toBeInTheDocument();
    expect(screen.getByLabelText('Amount')).toBeInTheDocument();
    // Pricing moved to its own tab.
    expect(screen.queryByLabelText('Supply price')).not.toBeInTheDocument();
  });

  it('shows the money fields on Pricing', async () => {
    const { user } = renderEntityEditor('product');
    await screen.findByLabelText('Name');

    await switchSection(user, 'Pricing');

    expect(await screen.findByLabelText('Supply price')).toBeInTheDocument();
    expect(screen.getByLabelText('Enable retail sales')).toBeInTheDocument();
  });

  it('shows the SKU and supplier fields on Identifiers', async () => {
    const { user } = renderEntityEditor('product');
    await screen.findByLabelText('Name');

    await switchSection(user, 'Identifiers');

    expect(await screen.findByLabelText('Supplier')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  });

  it('renders the photo uploader in the aside', async () => {
    renderEntityEditor('product');

    expect(await screen.findByText('Pictures')).toBeInTheDocument();
  });

  it('accepts input into a declared field', async () => {
    const { user } = renderEntityEditor('product');

    const name = await screen.findByLabelText('Name');
    await user.type(name, 'Argan oil shampoo');

    expect(name).toHaveValue('Argan oil shampoo');
  });

  it('reveals the retail price only once retail is enabled', async () => {
    const { user } = renderEntityEditor('product');
    await screen.findByLabelText('Name');
    await switchSection(user, 'Pricing');
    await screen.findByLabelText('Supply price');

    expect(screen.queryByLabelText('Retail price')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Enable retail sales'));

    expect(await screen.findByLabelText('Retail price')).toBeInTheDocument();
    expect(screen.getByLabelText('Markup')).toBeInTheDocument();
  });

  it('swaps content when the section changes, and gates the stock fields', async () => {
    const { user } = renderEntityEditor('product');
    await screen.findByLabelText('Name');

    await switchSection(user, 'Stock');

    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    const track = await screen.findByLabelText('Track stock');
    expect(screen.queryByLabelText('Low stock level')).not.toBeInTheDocument();

    await user.click(track);
    expect(await screen.findByLabelText('Low stock level')).toBeInTheDocument();
    expect(screen.getByLabelText('Reorder quantity')).toBeInTheDocument();
  });

  it('leaves the editor when cancelled', async () => {
    const { user } = renderEntityEditor('product');
    await screen.findByLabelText('Name');

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(navigate).toHaveBeenCalled();
  });
});
