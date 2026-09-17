import { describe, expect, it, vi } from 'vitest';

/**
 * COMPONENT TEST: the `lead-form` entity editor.
 *
 * Tier 1 of the two required tiers (see `entity-editor-coverage.test.ts`). The
 * three-step wizard the dialog ran is one section of three blocks here, so the
 * interesting thing to prove is that all three are on screen AT ONCE — no step
 * to walk to, and every validation message visible where it belongs. The
 * request body is the form contract's job (`lead-form.contract.test.tsx`).
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
    post: vi.fn().mockResolvedValue({ id: 'lf_1' }),
    put: vi.fn().mockResolvedValue({ id: 'lf_1' }),
    delete: vi.fn().mockResolvedValue({}),
  },
}));

import { apiClient } from '@borradh-workspace/api-client';

import {
  expectEditorChrome,
  renderEntityEditor,
  screen,
} from '../testing/render-entity-editor';

const post = apiClient.post as ReturnType<typeof vi.fn>;

describe('lead-form entity editor', () => {
  it('renders the shared chrome', async () => {
    renderEntityEditor('lead-form');

    await expectEditorChrome({ title: /create lead form/i });
  });

  it('shows all three former wizard steps at once', async () => {
    renderEntityEditor('lead-form');

    // Step 1, step 3 and step 2 of the old dialog, on one page.
    expect(await screen.findByLabelText('Form name')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Privacy policy URL (optional)')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /chat on messenger/i })
    ).toBeInTheDocument();
  });

  it('seeds the default question rows', async () => {
    renderEntityEditor('lead-form');

    await screen.findByLabelText('Form name');
    expect(screen.getAllByText('Full Name').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Edit field' }).length).toBe(
      4
    );
  });

  it('accepts input into a declared field', async () => {
    const { user } = renderEntityEditor('lead-form');

    const name = await screen.findByLabelText('Form name');
    await user.type(name, 'Spring Offer');

    expect(name).toHaveValue('Spring Offer');
  });

  it('reports the missing form name instead of submitting', async () => {
    const { user } = renderEntityEditor('lead-form');
    await screen.findByLabelText('Form name');

    await user.click(screen.getAllByRole('button', { name: /^save/i })[0]);

    expect(await screen.findByText(/form name is required/i)).toBeVisible();
    expect(post).not.toHaveBeenCalled();
  });

  it('leaves the editor when cancelled', async () => {
    const { user } = renderEntityEditor('lead-form');
    await screen.findByLabelText('Form name');

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(navigate).toHaveBeenCalled();
  });
});
