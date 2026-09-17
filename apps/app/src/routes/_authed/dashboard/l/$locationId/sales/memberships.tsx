import { useBranchRoutes } from '@/lib/use-routes';
import { Link, createFileRoute } from '@tanstack/react-router';
import { format } from 'date-fns';
import { RefreshCcw } from 'lucide-react';

import { ListPage } from '@/components/app/list-page';
import type { ListColumn } from '@/components/app/list-page';
import { Button } from '@/components/ui/button';
import { formatMoney, useListLeadMemberships } from '@/features/sales';
import {
  ExportMenu,
  StatusBadge,
  downloadCsv,
} from '@/features/sales/components/pages/sales-page-ui';
import { leadMembershipStatusLabels } from '@borradh-workspace/api-client/types';
import type { LeadMembershipWithPlan } from '@borradh-workspace/api-client/types';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/sales/memberships'
)({
  component: MembershipSalesPage,
});

/**
 * Membership sales, on the shared `ListPage`. One column config renders both
 * the desktop table and the phone list — the `MembershipsMobile` component that
 * restated these columns by hand is gone.
 */
function MembershipSalesPage() {
  const routes = useBranchRoutes();
  const { memberships, isLoading, isError, error } = useListLeadMemberships();

  const handleExport = () => {
    downloadCsv(
      'memberships-sold.csv',
      ['Plan', 'Status', 'Sessions', 'Valid until', 'Price'],
      memberships.map((m) => [
        m.plan.name,
        leadMembershipStatusLabels[m.status],
        m.sessionsRemaining ?? 'Unlimited',
        m.validUntil ? format(new Date(m.validUntil), 'd MMM yyyy') : '—',
        formatMoney(m.plan.priceCents, m.plan.currency),
      ])
    );
  };

  const columns: ListColumn<LeadMembershipWithPlan>[] = [
    {
      id: 'plan',
      header: 'Plan',
      mobile: 'primary',
      cell: (membership) => (
        <span className="font-medium">{membership.plan.name}</span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      // Under the plan name on a phone: whether the membership is still live
      // matters more there than the session count or the expiry date.
      mobile: 'secondary',
      cell: (membership) => (
        <StatusBadge tone={membership.status === 'active' ? 'green' : 'grey'}>
          {leadMembershipStatusLabels[membership.status]}
        </StatusBadge>
      ),
    },
    {
      id: 'sessions',
      header: 'Sessions',
      cell: (membership) => membership.sessionsRemaining ?? 'Unlimited',
    },
    {
      id: 'validUntil',
      header: 'Valid until',
      cell: (membership) =>
        membership.validUntil
          ? format(new Date(membership.validUntil), 'd MMM yyyy')
          : '—',
    },
    {
      id: 'price',
      header: 'Price',
      align: 'right',
      mobile: 'trailing',
      cell: (membership) =>
        formatMoney(membership.plan.priceCents, membership.plan.currency),
    },
  ];

  return (
    <>
      <title>Membership sales | Borradh</title>

      <ListPage<LeadMembershipWithPlan>
        config={{
          title: 'Membership sales',
          columns,
          rows: memberships,
          rowKey: (membership) => membership.id,
          toolbar: (
            <ExportMenu
              disabled={!memberships.length}
              label="Options"
              onExportCsv={handleExport}
            />
          ),
          isLoading,
          // BEFORE the empty state: `memberships` falls back to [] on a failed
          // request, so a clinic that sells memberships was being told it has
          // none and sent to "Set up now" to recreate what it already has.
          isError,
          errorMessage: error?.message ?? 'Failed to load memberships',
          empty: {
            icon: RefreshCcw,
            title: 'No memberships created yet',
            description:
              'Add memberships in minutes and start selling them online and via your store.',
            action: (
              <Button asChild className="rounded-full" variant="outline">
                <Link to={routes.catalogMemberships}>Set up now</Link>
              </Button>
            ),
          },
        }}
      />
    </>
  );
}
