import { createFileRoute } from '@tanstack/react-router';

import { PageShell } from '@/components/app/page-shell';
import { CustomerProfile } from '@/features/customers';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/customers/$leadId'
)({
  component: CustomerProfilePage,
});

/**
 * Unified client profile route (unify-customers Phase 4). Rendered through the
 * `customers.tsx` layout's `<Outlet />`.
 */
function CustomerProfilePage() {
  const { leadId } = Route.useParams();

  return (
    <>
      <title>Client | Borradh</title>
      <PageShell maxWidth="max-w-5xl">
        <CustomerProfile leadId={leadId} />
      </PageShell>
    </>
  );
}
