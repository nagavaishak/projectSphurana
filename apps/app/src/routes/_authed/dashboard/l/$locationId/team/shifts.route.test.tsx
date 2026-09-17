import { fireEvent, renderWithProviders, screen } from '@/test/render';
import type { ComponentType } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression guard for ENG-766.
 *
 * The team-roster helper banner tells the user to "click here" to set their
 * standard opening hours. That link was once a bare <button> with no handler,
 * so clicking it did nothing (ENG-766). It must navigate to the org
 * Details → Locations settings, where the standing opening-hours editor lives.
 *
 * This spec pins the wiring: rendering the desktop roster and clicking
 * "click here" must call navigate({ to: '/dashboard/settings/details' }). If the
 * onClick is dropped again, this fails in CI instead of shipping a dead link.
 */

// ── Router primitives: capture navigate, expose the route's component ────────
// Partial-mock so real exports survive; only override createFileRoute (so
// `Route.options.component` is the page) and useNavigate (to capture the call).
const navigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  createFileRoute: () => (opts: { component: ComponentType }) => ({
    options: opts,
  }),
  useNavigate: () => navigate,
}));

// Force the desktop branch of ShiftsRoute so <ShiftsPage /> (the banner's home)
// renders rather than the mobile variant.
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));

// The mobile variant is imported at module load but never rendered here; stub
// it so no transitive mobile-only deps have to resolve.
vi.mock('./-components/team-shifts-mobile', () => ({
  TeamShiftsMobile: () => null,
}));

// No team members → the roster renders its empty state, which keeps the table
// (and its own controls) out of the tree so the ONLY "click here"-style control
// is the banner link under test.
vi.mock('@/features/practitioners', () => ({
  useListPractitioners: () => ({ practitioners: [], isLoading: false }),
}));

// Scheduling barrel: hooks return empty/no-op, dialogs + label helpers are
// harmless stubs. TimeOffDialog renders unconditionally, so it must be a
// component; ShiftOverrideDialog only mounts with an active target (none here).
vi.mock('@/features/scheduling', () => ({
  useListShifts: () => ({ shiftDays: [], isLoading: false }),
  useSetShiftOverride: () => ({ setShiftOverride: vi.fn() }),
  useDeleteShiftOverride: () => ({ deleteShiftOverride: vi.fn() }),
  ShiftOverrideDialog: () => null,
  TimeOffDialog: () => null,
  TeamMemberMenu: ({ children }: { children?: unknown }) => children ?? null,
  formatHoursLabel: () => '',
  formatMinutesLabel: () => '',
}));

// Safety net: even if a hook slipped through the mocks, no real HTTP.
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue(null),
    post: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(null),
  },
}));

import { Route } from './shifts';

// biome-ignore lint/suspicious/noExplicitAny: the mocked route exposes options.component.
const ShiftsRoute = (Route as any).options.component as ComponentType;

describe('/dashboard/team/shifts · "set your opening hours" link (ENG-766)', () => {
  beforeEach(() => {
    navigate.mockReset();
  });

  it('navigates to the opening-hours settings when "click here" is clicked', () => {
    renderWithProviders(<ShiftsRoute />);

    fireEvent.click(screen.getByRole('button', { name: /click here/i }));

    expect(navigate).toHaveBeenCalledWith({
      to: '/dashboard/settings/details',
    });
  });
});
