import type { ReactNode } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, screen } from '@/test/render';

import {
  MobileDashboardHeader,
  MobileDashboardHeaderProvider,
} from '@/features/mobile-dashboard-header';

import { DashboardPage } from './dashboard-page';

/**
 * The phone chrome comes from the SHELL, not from each page.
 *
 * The shape: a back control ALONE on the floating bar, and the page title below
 * it in the page, left-aligned and large. Not a centred title in the bar — that
 * is iOS navigation chrome, and it shrinks the name of the screen to 15px just
 * as the user arrives on it.
 *
 * Before this, a page built on `DashboardPage` published nothing, so the phone
 * kept the root-screen header (branch chip + inbox + bell + avatar) on a screen
 * the user had navigated INTO — no way back — and then repeated the desktop
 * `<h1>` underneath it. These tests pin the shell as the single source of that
 * chrome, so a new page cannot opt out by forgetting.
 */

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock(
  '@/features/mobile-dashboard-header/mobile-header-inbox-button',
  () => ({
    MobileHeaderInboxButton: () => <button type="button">Inbox</button>,
  })
);
vi.mock(
  '@/features/mobile-dashboard-header/mobile-header-notifications-bell',
  () => ({
    MobileHeaderNotificationsBell: () => (
      <button type="button">Notifications</button>
    ),
  })
);
vi.mock('@/features/mobile-dashboard-header/mobile-header-location', () => ({
  MobileHeaderLocation: () => <div>Branch</div>,
}));
vi.mock('@/features/mobile-dashboard-header/mobile-header-user-menu', () => ({
  MobileHeaderUserMenu: () => <button type="button">Account</button>,
}));

// `useIsMobile()` reads window.innerWidth; the shared setup defaults specs to
// the DESKTOP breakpoint. These assertions are about the phone tree, so the
// suite moves the viewport for its lifetime and puts it back after.
const DESKTOP_WIDTH = window.innerWidth;

beforeAll(() => {
  window.innerWidth = 375;
});

afterAll(() => {
  window.innerWidth = DESKTOP_WIDTH;
});

function renderPage(ui: ReactNode) {
  return renderWithProviders(
    <MobileDashboardHeaderProvider>
      <MobileDashboardHeader />
      {ui}
    </MobileDashboardHeaderProvider>
  );
}

describe('DashboardPage phone chrome', () => {
  it('keeps the title in the page, not in the floating header', async () => {
    renderPage(
      <DashboardPage title="Products">
        <p>rows</p>
      </DashboardPage>
    );

    const header = await screen.findByRole('banner', { name: /dashboard/i });
    expect(header).not.toHaveTextContent('Products');

    const heading = screen.getByRole('heading', { name: 'Products' });
    expect(heading).toBeInTheDocument();
    expect(header).not.toContainElement(heading);
  });

  it('offers a way back and drops the root-screen controls', async () => {
    renderPage(
      <DashboardPage title="Products">
        <p>rows</p>
      </DashboardPage>
    );

    expect(
      await screen.findByRole('button', { name: /go back/i })
    ).toBeInTheDocument();
    // Inbox, bell and avatar were root-screen chrome on a screen you navigate
    // INTO; they are a tab and two cards in More now.
    expect(
      screen.queryByRole('button', { name: 'Account' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Inbox' })
    ).not.toBeInTheDocument();
  });

  it('keeps the branch switcher reachable on a drill-down', async () => {
    renderPage(
      <DashboardPage title="Products">
        <p>rows</p>
      </DashboardPage>
    );

    // The switcher shares the bar with Back rather than losing the corner to
    // it. Before, the chip was the last arm of the LEADING slot, so every
    // screen with a back control — which, through this shell, is nearly all of
    // them — silently had no way to change branch.
    expect(await screen.findByText('Branch')).toBeInTheDocument();
  });

  it('renders exactly one heading for the page title', async () => {
    renderPage(
      <DashboardPage title="Products">
        <p>rows</p>
      </DashboardPage>
    );

    // One <h1>. The header publishes no heading precisely so that this stays
    // true — two would compete in the heading rotor and in
    // `getByRole('heading')`.
    expect(
      await screen.findAllByRole('heading', { name: 'Products' })
    ).toHaveLength(1);
  });

  it('gives the page one scroll region, not two', async () => {
    const { container } = renderPage(
      <DashboardPage title="Products">
        <p>rows</p>
      </DashboardPage>
    );

    // The shell scrolls; anything nested inside it must not scroll as well, or
    // the rows move inside a box that is also moving.
    expect(container.querySelectorAll('[data-mobile-scroll]')).toHaveLength(1);
  });

  it('lets a root screen keep the root chrome', async () => {
    renderPage(
      <DashboardPage mobileHeader={false} title="Home">
        <p>rows</p>
      </DashboardPage>
    );

    expect(
      screen.queryByRole('button', { name: /go back/i })
    ).not.toBeInTheDocument();
    expect(await screen.findByText('Branch')).toBeInTheDocument();
  });

  it('renders without a header provider (page rendered on its own in a test)', () => {
    renderWithProviders(
      <DashboardPage title="Products">
        <p>rows</p>
      </DashboardPage>
    );

    expect(
      screen.getByRole('heading', { name: 'Products' })
    ).toBeInTheDocument();
  });
});
