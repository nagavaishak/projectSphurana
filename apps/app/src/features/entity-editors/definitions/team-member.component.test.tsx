import { describe, expect, it, vi } from 'vitest';

/**
 * COMPONENT TEST: the `team-member` entity editor.
 *
 * Tier 1 of the two required tiers (see `entity-editor-coverage.test.ts`). It
 * proves the five panels the bespoke full-screen editor used to own — Profile,
 * Services, Locations, Settings, Wages — still render as sections and still take
 * input. The request bodies are the form contract's job
 * (`create-team-member.contract.test.tsx` and the two assign-* contracts).
 *
 * Locations gets an explicit case: practitioner→branch assignment is the spine
 * of the location work, and "the panel silently stopped rendering" is exactly
 * the regression a page migration can introduce.
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

const LOCATIONS = [
  { id: 'loc_1', name: 'Main Salon', isPrimary: true },
  { id: 'loc_2', name: 'Northside Branch', isPrimary: false },
];

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: vi.fn((path: string) => {
      if (path.startsWith('organization-locations')) {
        return Promise.resolve({ items: LOCATIONS });
      }
      if (path.startsWith('organization-services')) {
        return Promise.resolve({ items: [], total: 0 });
      }
      return Promise.resolve({ items: [] });
    }),
    post: vi.fn().mockResolvedValue({ id: 'prac_1' }),
    put: vi.fn().mockResolvedValue({ id: 'prac_1' }),
    delete: vi.fn().mockResolvedValue({}),
  },
}));

import {
  expectEditorChrome,
  renderEntityEditor,
  screen,
  switchSection,
} from '../testing/render-entity-editor';

describe('team-member entity editor', () => {
  it('renders the shared chrome and all five sections', async () => {
    renderEntityEditor('team-member');

    await expectEditorChrome({
      title: /add team member/i,
      sections: [
        'Profile',
        'Services',
        'Locations',
        'Settings',
        'Wages and timesheets',
      ],
    });
  });

  it('shows the profile fields on the first section', async () => {
    renderEntityEditor('team-member');

    expect(await screen.findByLabelText('First name')).toBeInTheDocument();
    expect(screen.getByLabelText('Last name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('accepts input into a profile field', async () => {
    const { user } = renderEntityEditor('team-member');

    const firstName = await screen.findByLabelText('First name');
    await user.type(firstName, 'Grace');

    expect(firstName).toHaveValue('Grace');
  });

  it('lists the org locations on the Locations section and toggles one', async () => {
    const { user } = renderEntityEditor('team-member');
    await screen.findByLabelText('First name');

    await switchSection(user, 'Locations');

    // Create mode seeds every location as selected — the assignment the
    // location-focused work depends on.
    const northside = await screen.findByRole('checkbox', {
      name: 'Northside Branch',
    });
    expect(northside).toHaveAttribute('data-state', 'checked');

    await user.click(northside);
    expect(northside).toHaveAttribute('data-state', 'unchecked');

    // The profile fields are gone — the sections are real content, not tabs
    // over one long form.
    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
  });

  it('shows the wages panel on its own section', async () => {
    const { user } = renderEntityEditor('team-member');
    await screen.findByLabelText('First name');

    await switchSection(user, 'Wages and timesheets');

    expect(await screen.findByLabelText('Compensation')).toBeInTheDocument();
  });

  it('leaves the editor when cancelled', async () => {
    const { user } = renderEntityEditor('team-member');
    await screen.findByLabelText('First name');

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(navigate).toHaveBeenCalled();
  });
});
