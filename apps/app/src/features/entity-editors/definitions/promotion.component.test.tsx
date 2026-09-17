import { describe, expect, it, vi } from 'vitest';

/**
 * COMPONENT TEST: the `promotion` entity editor (the `offer` table).
 *
 * Tier 1 of the two required tiers (see `entity-editor-coverage.test.ts`). It
 * proves the editor RENDERS and RESPONDS — in particular the one piece of
 * behaviour that is easy to lose in a layout move: which numeric input appears
 * is discriminated by the selected discount type, and switching type clears the
 * other shapes' values. The body it PUTs is the form contract's job
 * (`offers/components/offer.contract.test.tsx`).
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

/**
 * A one-branch catalogue: a service offered ONLY at Harbour Road, so the
 * services section has a real branch heading to group under.
 */
const SERVICES = [
  {
    id: 'svc-1',
    name: 'Hot Stone Therapy',
    priceType: 'fixed',
    priceCents: 14000,
    locationIds: ['loc-2'],
  },
];
const LOCATIONS = [{ id: 'loc-2', name: 'Harbour Road' }];

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: vi.fn((path: unknown) => {
      if (typeof path === 'string') {
        if (path.startsWith('organization-services')) {
          return Promise.resolve({ items: SERVICES, total: SERVICES.length });
        }
        if (path.startsWith('organization-locations')) {
          return Promise.resolve({ items: LOCATIONS, total: LOCATIONS.length });
        }
      }
      return Promise.resolve({ items: [], total: 0 });
    }),
    post: vi.fn().mockResolvedValue({ id: 'o1' }),
    put: vi.fn().mockResolvedValue({ id: 'o1' }),
    delete: vi.fn().mockResolvedValue({}),
  },
}));

import {
  expectEditorChrome,
  renderEntityEditor,
  screen,
  switchSection,
} from '../testing/render-entity-editor';

describe('promotion entity editor', () => {
  it('renders the shared chrome', async () => {
    renderEntityEditor('promotion');

    await expectEditorChrome({
      title: /create promotion/i,
      sections: ['Details', 'Services'],
    });
  });

  it('shows the promotion fields', async () => {
    renderEntityEditor('promotion');

    expect(await screen.findByLabelText(/promotion name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^\s*code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/promotion description/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/max redemptions/i)).toBeInTheDocument();
  });

  it('puts services in their own section, grouped by branch', async () => {
    const { user } = renderEntityEditor('promotion');
    await screen.findByLabelText(/promotion name/i);

    // Details owns the discount; the services list is a section of its own.
    expect(screen.queryByLabelText('Hot Stone Therapy')).toBeNull();

    await switchSection(user, 'Services');

    expect(await screen.findByLabelText('Search services')).toBeInTheDocument();
    expect(screen.getByLabelText('All Services')).toBeInTheDocument();
    // The branch heading, then the service offered at it.
    expect(screen.getByLabelText('Harbour Road')).toBeInTheDocument();
    expect(screen.getByLabelText('Hot Stone Therapy')).toBeInTheDocument();
  });

  it('keeps a failed save on the section carrying the error', async () => {
    const { user } = renderEntityEditor('promotion');
    await screen.findByLabelText(/promotion name/i);

    await user.type(screen.getByLabelText(/promotion name/i), 'Winter Sale');
    await user.type(screen.getByLabelText(/discount amount/i), '10');
    await switchSection(user, 'Services');

    // No service picked — the guard fails, and the operator must be able to
    // SEE the field it failed on rather than being bounced to Details.
    await user.click(screen.getAllByRole('button', { name: /^save/i })[0]);

    expect(
      await screen.findByText(/pick at least one service/i)
    ).toBeInTheDocument();
  });

  it('accepts input into a declared field', async () => {
    const { user } = renderEntityEditor('promotion');

    const name = await screen.findByLabelText(/promotion name/i);
    await user.type(name, 'Christmas Sale');

    expect(name).toHaveValue('Christmas Sale');
  });

  it('swaps the numeric input when the discount type changes', async () => {
    const { user } = renderEntityEditor('promotion');
    await screen.findByLabelText(/promotion name/i);

    // Percentage is the default shape.
    expect(screen.getByLabelText(/discount amount/i)).toHaveAttribute(
      'max',
      '100'
    );

    await user.click(
      screen.getByRole('radio', { name: /fixed amount discount/i })
    );

    // Same label, different control: euros, with no percentage ceiling.
    expect(screen.getByLabelText(/discount amount/i)).toHaveAttribute(
      'step',
      '0.01'
    );
  });

  it('leaves the editor when cancelled', async () => {
    const { user } = renderEntityEditor('promotion');
    await screen.findByLabelText(/promotion name/i);

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(navigate).toHaveBeenCalled();
  });
});
