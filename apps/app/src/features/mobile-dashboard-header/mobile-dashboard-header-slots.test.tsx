import { renderWithProviders, screen } from '@/test/render';
import { useMemo } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MobileDashboardHeader } from './mobile-dashboard-header';
import {
  MobileDashboardHeaderProvider,
  useMobileDashboardHeaderContent,
} from './mobile-dashboard-header-context';

/**
 * The bookings page drives the header entirely from slots: a burger on the
 * leading edge and the date dropdown as the title. Both must survive the
 * field-by-field copy in `useMobileDashboardHeaderContent` (a field left out of
 * the destructure is dropped silently) and must not displace the default
 * trailing controls.
 */

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./mobile-header-inbox-button', () => ({
  MobileHeaderInboxButton: () => <button type="button">Inbox</button>,
}));
vi.mock('./mobile-header-notifications-bell', () => ({
  MobileHeaderNotificationsBell: () => (
    <button type="button">Notifications</button>
  ),
}));
vi.mock('./mobile-header-location', () => ({
  // The branch chip is the leading slot's default. Stubbed like its sibling
  // header controls: it reads the locations query and the router, neither of
  // which this suite provides, and nothing here asserts on the branch.
  MobileHeaderLocation: () => <div>Branch</div>,
}));
vi.mock('./mobile-header-user-menu', () => ({
  MobileHeaderUserMenu: () => <button type="button">Account</button>,
}));

function BookingsPage() {
  useMobileDashboardHeaderContent(
    useMemo(
      () => ({
        leadingSlot: <button type="button">View and filter options</button>,
        titleSlot: <button type="button">Sun, Jul 12</button>,
      }),
      []
    )
  );
  return null;
}

function renderHeader() {
  return renderWithProviders(
    <MobileDashboardHeaderProvider>
      <MobileDashboardHeader />
      <BookingsPage />
    </MobileDashboardHeaderProvider>
  );
}

describe('mobile dashboard header slots', () => {
  it('renders the page-supplied leading and title slots', async () => {
    renderHeader();

    expect(
      await screen.findByRole('button', { name: 'View and filter options' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Sun, Jul 12' })
    ).toBeInTheDocument();
  });

  it('leaves the trailing edge to the page', async () => {
    renderHeader();

    await screen.findByRole('button', { name: 'Sun, Jul 12' });
    // The header used to end in a fixed inbox / bell / avatar trio on every
    // screen. Inbox is a bottom tab now, and Profile and Notifications are
    // cards in More — each a labelled destination instead of an unlabelled
    // glass circle, and the corner belongs to the page again.
    expect(
      screen.queryByRole('button', { name: 'Inbox' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Notifications' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Account' })
    ).not.toBeInTheDocument();
  });
});
