import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { DashboardPage } from '@/components/app/dashboard-page';
import { NotificationsPanel } from '@/features/notifications';
import { ROUTES } from '@/lib/route-paths';

export const Route = createFileRoute('/_authed/dashboard/notifications')({
  component: NotificationsPage,
});

/**
 * Notifications as a PAGE.
 *
 * They used to exist only as a bottom sheet behind the header bell. With the
 * bell gone from the header, the feed needs somewhere to live that a card in
 * More can link to — and a destination with a URL is the better shape anyway:
 * it is linkable, back-button-able, and it renders in the same shell as every
 * other screen instead of a sheet with its own chrome.
 *
 * The panel is unchanged and still used in the sheet by any page that composes
 * the bell into its own `extraActions`.
 */
function NotificationsPage() {
  const navigate = useNavigate();
  // Back goes to More, the card you came from — not browser history, which on a
  // deep link (a push notification) would leave the page with nowhere to go.
  const handleBack = useCallback(() => {
    void navigate({ to: ROUTES.more });
  }, [navigate]);

  return (
    <>
      <title>Notifications | Borradh</title>
      <DashboardPage
        mobileHeader={{ onBack: handleBack }}
        title="Notifications"
      >
        <div className="rounded-xl border bg-card">
          <NotificationsPanel />
        </div>
      </DashboardPage>
    </>
  );
}
