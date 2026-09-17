import { describe, expect, it, vi } from 'vitest';

/**
 * COMPONENT TEST: the `stock-take` entity editor.
 *
 * Tier 1 of the two required tiers. It proves the three controls render and
 * respond; the body POSTed to `/stock-takes` is the contract's job
 * (`stock-take.contract.test.tsx`).
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
    get: vi.fn().mockResolvedValue({ items: [] }),
    post: vi.fn().mockResolvedValue({ id: 'take_1' }),
    put: vi.fn().mockResolvedValue({ id: 'take_1' }),
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

describe('stock-take entity editor', () => {
  it('renders the shared chrome', async () => {
    renderEntityEditor('stock-take');

    await expectEditorChrome({ title: /new stocktake/i });
  });

  it('shows the three stocktake controls', async () => {
    renderEntityEditor('stock-take');

    expect(await screen.findByLabelText('Location')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
  });

  it('defaults the location to the primary one', async () => {
    renderEntityEditor('stock-take');

    expect(await screen.findByText('Bray Studio')).toBeInTheDocument();
  });

  it('accepts input into a declared field', async () => {
    const { user } = renderEntityEditor('stock-take');

    const name = await screen.findByLabelText('Name');
    await user.type(name, 'Monthly count');

    expect(name).toHaveValue('Monthly count');
  });

  it('leaves the editor when cancelled', async () => {
    const { user } = renderEntityEditor('stock-take');
    await screen.findByLabelText('Name');

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(navigate).toHaveBeenCalled();
  });
});
