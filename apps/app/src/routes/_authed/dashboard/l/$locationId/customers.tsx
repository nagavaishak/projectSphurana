import { useBranchRoutes } from '@/lib/use-routes';
import {
  Outlet,
  createFileRoute,
  useChildMatches,
  useNavigate,
} from '@tanstack/react-router';
import { z } from 'zod';

import { CustomersPage as CustomersList } from '@/features/customers';

/**
 * Search schema for the Customers surface. `tab` is search-param driven so the
 * active tab is linkable and survives reload; an unknown/missing value falls
 * back to `all`.
 */
const customersSearchSchema = z.object({
  // Optional so links to `/dashboard/customers` (and the `$leadId` child) don't
  // have to carry a search param; absent/invalid resolves to `all` in-component.
  tab: z.enum(['all', 'leads', 'contacted', 'booked']).optional().catch('all'),
});

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/customers'
)({
  validateSearch: customersSearchSchema,
  component: CustomersPage,
});

/**
 * Unified Clients surface (unify-customers). At `/dashboard/customers` this
 * renders the tabbed list; when the `$leadId` child matches it renders that
 * profile instead (this file doubles as the section layout, mirroring
 * `patients.tsx`). This is the canonical Clients destination — it replaces the
 * old `/dashboard/clients/list` leads table in the nav.
 *
 * There is no `useIsMobile` branch here any more: the list is one `ListPage`,
 * which picks the table or the phone list from the same column config.
 */
function CustomersPage() {
  const childMatches = useChildMatches();
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const routes = useBranchRoutes();

  if (childMatches.length > 0) {
    return <Outlet />;
  }

  return (
    <>
      <title>Customers | Borradh</title>
      <CustomersList
        onTabChange={(next) =>
          navigate({ to: routes.customers, search: { tab: next } })
        }
        tab={tab ?? 'all'}
      />
    </>
  );
}
