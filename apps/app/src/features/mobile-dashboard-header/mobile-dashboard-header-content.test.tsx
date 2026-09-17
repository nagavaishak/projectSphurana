import { renderWithProviders, screen } from '@/test/render';
import { useMemo } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MobileDashboardHeader } from './mobile-dashboard-header';
import {
  MobileDashboardHeaderProvider,
  useMobileDashboardHeaderContent,
} from './mobile-dashboard-header-context';

/**
 * `useMobileDashboardHeaderContent` rebuilds the content object field-by-field
 * before handing it to the context. Every field a page can set must survive that
 * copy — a field left out of the destructure is dropped silently, and the page's
 * control simply never renders (this is how the team-members "Add team member"
 * button went missing on mobile).
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

function Page({ hideInbox }: { hideInbox?: boolean }) {
  useMobileDashboardHeaderContent(
    // Memoized, as every real caller must be: the header content's ReactNode
    // fields are compared by reference.
    useMemo(
      () => ({
        heading: 'Team',
        hideInbox,
        extraActions: <button type="button">Add team member</button>,
      }),
      [hideInbox]
    )
  );
  return null;
}

function renderHeader(props: { hideInbox?: boolean } = {}) {
  return renderWithProviders(
    <MobileDashboardHeaderProvider>
      <MobileDashboardHeader />
      <Page hideInbox={props.hideInbox} />
    </MobileDashboardHeaderProvider>
  );
}

describe('useMobileDashboardHeaderContent', () => {
  it('renders the page-supplied extraActions in the header', async () => {
    renderHeader();

    expect(
      await screen.findByRole('button', { name: 'Add team member' })
    ).toBeInTheDocument();
  });

  it('renders extraActions ALONE — there is no default trailing trio', async () => {
    renderHeader();

    await screen.findByRole('button', { name: 'Add team member' });
    // The trio (inbox / bell / avatar) used to render after `extraActions` on
    // every dashboard screen. Inbox is a bottom tab now, and Profile and
    // Notifications are cards in More, so a page's own control is the only
    // thing on the trailing edge.
    expect(screen.queryByRole('button', { name: 'Inbox' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Account' })).toBeNull();
  });
});
