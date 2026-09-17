import { describe, expect, it, vi } from 'vitest';

/**
 * COMPONENT TEST: the `service` entity editor.
 *
 * Tier 1 of the two required tiers (see `entity-editor-coverage.test.ts`). This
 * proves the editor RENDERS and RESPONDS — its sections, its fields, its save
 * wiring. It deliberately does NOT assert the request body: that is the form
 * contract's job (`service-form.contract.test.tsx`), because a form can render
 * perfectly and still POST something the API rejects.
 *
 * Note how little there is here. The chrome, section navigation, layout, scroll
 * behaviour and save bar are proven once in the shared harness, so an entity's
 * own spec only covers what is genuinely its own.
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
    // Shape MATTERS per endpoint. `service-categories` returns a bare array
    // (`query.data ?? []`), while services/practitioners return `{ items }`.
    // A blanket `{ items: [] }` made `categories` an object, and the config's
    // `categories.map(...)` threw — crashing the whole editor, which is why
    // three unrelated assertions failed at once.
    get: vi
      .fn()
      .mockImplementation((path: string) =>
        path.startsWith('service-categories')
          ? Promise.resolve([])
          : Promise.resolve({ items: [], total: 0, limit: 100, offset: 0 })
      ),
    post: vi.fn().mockResolvedValue({ id: 'svc_1' }),
    put: vi.fn().mockResolvedValue({ id: 'svc_1' }),
    delete: vi.fn().mockResolvedValue({}),
  },
}));

import {
  expectEditorChrome,
  renderEntityEditor,
  screen,
  switchSection,
} from '../testing/render-entity-editor';

describe('service entity editor', () => {
  it('renders the shared chrome and both sections', async () => {
    renderEntityEditor('service');

    await expectEditorChrome({
      title: /create service/i,
      sections: ['Details', 'Team Members'],
    });
  });

  it('shows the service fields on the Details section', async () => {
    renderEntityEditor('service');

    expect(await screen.findByLabelText('Service Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
  });

  it('accepts input into a declared field', async () => {
    const { user } = renderEntityEditor('service');

    const name = await screen.findByLabelText('Service Name');
    await user.type(name, 'Deep Cleanse');

    expect(name).toHaveValue('Deep Cleanse');
  });

  it('swaps content when the section changes', async () => {
    const { user } = renderEntityEditor('service');
    await screen.findByLabelText('Service Name');

    await switchSection(user, 'Team Members');

    // The Details fields are gone and the team section is showing — proof the
    // sections are real content, not tabs over one long form.
    expect(screen.queryByLabelText('Service Name')).not.toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: /team members/i })
    ).toBeInTheDocument();
  });

  it('leaves the editor when cancelled', async () => {
    const { user } = renderEntityEditor('service');
    await screen.findByLabelText('Service Name');

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(navigate).toHaveBeenCalled();
  });
});
