import { Outlet, createFileRoute } from '@tanstack/react-router';

import { SalesNotificationBanner } from '@/features/stripe-connect';

/**
 * Sales section layout. Surfaces the embedded Stripe notification banner (shown
 * only when a controller account has outstanding requirements) above the
 * section content.
 */
export const Route = createFileRoute('/_authed/dashboard/l/$locationId/sales')({
  component: SalesLayout,
});

function SalesLayout() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SalesNotificationBanner />
      <Outlet />
    </div>
  );
}
