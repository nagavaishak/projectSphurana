import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCheckoutStore } from '@/features/sales/store/checkout-store';
import { BRANCH_PATHS } from '@/lib/route-paths';

import { MobileQuickAddSheet } from './mobile-quick-add-sheet';
// `useResolvedRoutes()` gained a locations-query arm (its last resort, after the
// URL and the remembered branch). That makes React Query a hard dependency of
// any component that merely renders a branch link. This suite is not about
// branch resolution, so the query is stubbed rather than wrapped in a provider;
// an empty list keeps the exact resolution path the assertions below assume.
vi.mock(
  '@/features/organization-locations/api/list-locations/list-locations.hook',
  () => ({ useListLocations: () => ({ locations: [], isLoading: false }) })
);

const navigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  // The sheet builds branch-scoped hrefs, which reads the branch out of the
  // pathname. An org-level path exercises the un-prefixed fallback — the
  // targets asserted below are the pre-branch ones, which the compatibility
  // splat redirects.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard' } }),
}));

describe('MobileQuickAddSheet', () => {
  beforeEach(() => {
    navigate.mockReset();
    useCheckoutStore.setState({
      open: false,
      params: {},
      quickPaymentEntry: false,
    });
  });

  it('offers the same four actions as the desktop add menu', () => {
    render(<MobileQuickAddSheet open onOpenChange={() => {}} />);

    expect(screen.getByTestId('quick-add-appointment')).toBeInTheDocument();
    expect(screen.getByTestId('quick-add-blocked-time')).toBeInTheDocument();
    expect(screen.getByTestId('quick-add-sale')).toBeInTheDocument();
    expect(screen.getByTestId('quick-add-quick-payment')).toBeInTheDocument();
  });

  it('routes to the mobile appointment and blocked-time flows', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <MobileQuickAddSheet open onOpenChange={onOpenChange} />
    );

    fireEvent.click(screen.getByTestId('quick-add-appointment'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(navigate).toHaveBeenCalledWith({ to: BRANCH_PATHS.calendarNew });

    rerender(<MobileQuickAddSheet open onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByTestId('quick-add-blocked-time'));
    expect(navigate).toHaveBeenCalledWith({
      to: BRANCH_PATHS.calendarNewBlock,
    });
  });

  it('drives sale and quick payment through the checkout store', () => {
    const { rerender } = render(
      <MobileQuickAddSheet open onOpenChange={() => {}} />
    );

    fireEvent.click(screen.getByTestId('quick-add-sale'));
    expect(useCheckoutStore.getState().open).toBe(true);
    expect(useCheckoutStore.getState().quickPaymentEntry).toBe(false);

    rerender(<MobileQuickAddSheet open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByTestId('quick-add-quick-payment'));
    expect(useCheckoutStore.getState().quickPaymentEntry).toBe(true);
    expect(useCheckoutStore.getState().open).toBe(false);
  });
});
