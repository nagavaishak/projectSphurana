import { describe, expect, it, vi } from 'vitest';

/**
 * COMPONENT TEST: the `membership` entity editor.
 *
 * Tier 1 of the two required tiers (see `entity-editor-coverage.test.ts`). It
 * proves the editor RENDERS and RESPONDS. The body it POSTs is the form
 * contract's job (`membership-plan.contract.test.tsx`) — a form can render
 * perfectly and still send something the API rejects.
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
    post: vi.fn().mockResolvedValue({ id: 'plan_1' }),
    put: vi.fn().mockResolvedValue({ id: 'plan_1' }),
    delete: vi.fn().mockResolvedValue({}),
  },
}));

import {
  expectEditorChrome,
  renderEntityEditor,
  screen,
} from '../testing/render-entity-editor';

describe('membership entity editor', () => {
  it('renders the shared chrome', async () => {
    renderEntityEditor('membership');

    await expectEditorChrome({ title: /add membership/i });
  });

  it('shows the membership fields', async () => {
    renderEntityEditor('membership');

    expect(await screen.findByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByLabelText('Number of sessions')).toBeInTheDocument();
    expect(screen.getByLabelText('Price')).toBeInTheDocument();
  });

  it('accepts input into a declared field', async () => {
    const { user } = renderEntityEditor('membership');

    const name = await screen.findByLabelText('Name');
    await user.type(name, 'Gold membership');

    expect(name).toHaveValue('Gold membership');
  });

  it('hides the session count when the plan is unlimited', async () => {
    const { user } = renderEntityEditor('membership');
    await screen.findByLabelText('Number of sessions');

    await user.click(screen.getByRole('radio', { name: 'Unlimited' }));

    expect(
      screen.queryByLabelText('Number of sessions')
    ).not.toBeInTheDocument();
  });

  it('leaves the editor when cancelled', async () => {
    const { user } = renderEntityEditor('membership');
    await screen.findByLabelText('Name');

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(navigate).toHaveBeenCalled();
  });
});
