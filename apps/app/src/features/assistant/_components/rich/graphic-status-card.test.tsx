import { graphicStatusValues } from '@borradh-workspace/labels';
import { act, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphicStatusCard } from './graphic-status-card';
// `useResolvedRoutes()` gained a locations-query arm (its last resort, after the
// URL and the remembered branch). That makes React Query a hard dependency of
// any component that merely renders a branch link. This suite is not about
// branch resolution, so the query is stubbed rather than wrapped in a provider;
// an empty list keeps the exact resolution path the assertions below assume.
vi.mock(
  '@/features/organization-locations/api/list-locations/list-locations.hook',
  () => ({ useListLocations: () => ({ locations: [], isLoading: false }) })
);

// The card polls GET /graphics/:id through apiClient — stub it out.
const getMock = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: { get: (...args: unknown[]) => getMock(...args) },
}));

// The fallback link renders a TanStack <Link>; a bare anchor is enough here.
// `useRouterState` is stubbed alongside it because the card builds that link
// through `useResolvedRoutes()`, which reads the active branch off the path —
// without it the hook calls into a router that was never mounted.
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({
    select,
  }: {
    select: (s: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: '/dashboard/l/main/home' } }),
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children: ReactNode;
  } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const POLL_INTERVAL = 4_000;

/**
 * Contract: the graphics status enum (packages/labels/src/graphics.ts) plus
 * any unknown string must be handled by the card. Audit finding #172: an
 * unrecognised status used to render a permanent skeleton with the poller
 * never starting.
 */
const Card = GraphicStatusCard;

const TERMINAL = new Set(['ready', 'failed']);
const UNKNOWN_STATUS = 'prepared'; // not in the enum — must still be handled
const allStatuses = [...graphicStatusValues, UNKNOWN_STATUS];

describe('GraphicStatusCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getMock.mockReset();
    // Keep the card in a non-terminal state so polling assertions are stable.
    getMock.mockResolvedValue({ id: 'g1', status: 'rendering' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(allStatuses)('renders visible output for status "%s"', (status) => {
    const { container } = render(
      <Card data={{ graphicId: 'g1', status, title: 'Promo graphic' }} />
    );
    expect(container.firstChild).not.toBeNull();
  });

  it.each(allStatuses.filter((s) => !TERMINAL.has(s)))(
    'polls the graphics endpoint for non-terminal status "%s"',
    async (status) => {
      render(<Card data={{ graphicId: 'g1', status }} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL);
      });
      expect(getMock).toHaveBeenCalledWith('graphics/g1');
    }
  );

  it.each([...TERMINAL])(
    'does not poll for terminal status "%s"',
    async (status) => {
      render(<Card data={{ graphicId: 'g1', status }} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL * 2);
      });
      expect(getMock).not.toHaveBeenCalled();
    }
  );

  it('shows a fallback "open in Content" link for an unknown status', () => {
    render(<Card data={{ graphicId: 'g1', status: UNKNOWN_STATUS }} />);
    const link = screen.getByRole('link', { name: /open it in content/i });
    // Branch-scoped: the gallery lives under the active branch, and the card
    // resolves it from the path rather than spelling a legacy /dashboard/… URL
    // that would only work via the compatibility splat.
    expect(link.getAttribute('href')).toBe(
      '/dashboard/l/main/marketing/gallery'
    );
  });

  it('shows the failure card for status "failed"', () => {
    render(<Card data={{ graphicId: 'g1', status: 'failed' }} />);
    expect(screen.getByText(/failed/i)).not.toBeNull();
  });
});
