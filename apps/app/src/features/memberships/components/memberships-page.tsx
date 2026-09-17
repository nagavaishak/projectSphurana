import type { ListedMembershipPlan } from '@borradh-workspace/api-client/types';
import {
  membershipPricingTypeLabels,
  membershipValidForLabels,
} from '@borradh-workspace/api-client/types';
import { useNavigate } from '@tanstack/react-router';
import { BadgeCheck, MoreHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { ListPage } from '@/components/app/list-page';
import type { ListColumn } from '@/components/app/list-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  isSharedAcrossBranches,
  useActiveLocation,
} from '@/features/organization-locations';
import { useOrgCurrency } from '@/hooks/use-org-currency';
import { ImportMembershipPlansDialog } from '../import-membership-plans-dialog';

import {
  useDeleteMembershipPlan,
  useListMembershipPlans,
  useRemoveMembershipPlanLocation,
} from '../api';

/**
 * Memberships list, on the shared `ListPage`.
 *
 * There is no `useIsMobile` branch and no `MembershipsMobileList` any more: the
 * desktop table and the phone list render from the SAME column config, so a
 * column added here cannot silently fail to reach the phone. That deleted
 * component was ~a page of markup restating these columns by hand.
 */
export function MembershipsPage() {
  const { plans, isLoading, isError, error } = useListMembershipPlans();
  const {
    location: activeLocation,
    locations,
    isMultiLocation,
  } = useActiveLocation();
  const { removeMembershipPlanLocationAsync, isRemoving } =
    useRemoveMembershipPlanLocation();
  const [importOpen, setImportOpen] = useState(false);
  const { deleteMembershipPlan, isDeleting } = useDeleteMembershipPlan();
  const { format } = useOrgCurrency();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  // `ListedMembershipPlan`: the delete prompt needs the row's `locationIds`
  // to know whether it is withdrawing from one branch or all of them.
  const [deleteTarget, setDeleteTarget] = useState<ListedMembershipPlan | null>(
    null
  );
  const sharedAcrossBranches = isSharedAcrossBranches({
    locationIds: deleteTarget?.locationIds,
    totalBranches: locations.length,
  });
  const branchLabel =
    activeLocation?.name ?? activeLocation?.addressLine1 ?? 'this location';

  // Create and edit live on the SHARED editor routes (`/create/membership`,
  // `/edit/membership/:id`) — see features/entity-editors.
  const openCreate = () =>
    void navigate({ params: { entity: 'membership' }, to: '/create/$entity' });
  const openEdit = (plan: ListedMembershipPlan) =>
    void navigate({
      params: { entity: 'membership', id: plan.id },
      to: '/edit/$entity/$id',
    });

  // Filtering stays HERE, not in the shell: what counts as a match differs per
  // list, and hiding it in shared code makes it unfindable.
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return plans;
    return plans.filter(
      (plan) =>
        plan.name.toLowerCase().includes(term) ||
        (plan.description ?? '').toLowerCase().includes(term)
    );
  }, [plans, search]);

  const columns: ListColumn<ListedMembershipPlan>[] = [
    {
      id: 'name',
      header: 'Name',
      mobile: 'primary',
      cell: (plan) => (
        <div>
          <div className="font-medium">{plan.name}</div>
          {plan.description && (
            // Desktop only: the phone row is name + price, per the design.
            // `md:block` alone does NOT hide it — it needs `hidden` first.
            <div className="hidden max-w-xs truncate text-muted-foreground text-xs md:block">
              {plan.description}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'price',
      header: 'Price',
      align: 'right',
      // The phone shows the price under the name, as designed.
      mobile: 'secondary',
      cell: (plan) => (
        <span className="font-medium">{format(plan.priceCents)}</span>
      ),
    },
    {
      id: 'sessions',
      header: 'Sessions',
      mobile: 'trailing',
      cell: (plan) =>
        plan.sessionCount == null ? 'Unlimited' : plan.sessionCount,
    },
    {
      id: 'services',
      header: 'Services',
      cell: (plan) =>
        plan.serviceIds.length > 0
          ? `${plan.serviceIds.length} service${plan.serviceIds.length === 1 ? '' : 's'}`
          : '—',
    },
    {
      id: 'pricing',
      header: 'Pricing',
      cell: (plan) => membershipPricingTypeLabels[plan.pricingType],
    },
    {
      id: 'validFor',
      header: 'Valid for',
      cell: (plan) => membershipValidForLabels[plan.validFor],
    },
    {
      id: 'status',
      header: 'Status',
      cell: (plan) => (
        <Badge variant={plan.isActive ? 'default' : 'secondary'}>
          {plan.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <title>Memberships | Borradh</title>

      <ListPage<ListedMembershipPlan>
        config={{
          title: 'Memberships',
          columns,
          rows,
          rowKey: (plan) => plan.id,
          onRowClick: openEdit,
          rowActions: (plan) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={`Actions for ${plan.name}`}
                  size="icon"
                  variant="ghost"
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEdit(plan)}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setDeleteTarget(plan)}
                  variant="destructive"
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
          searchPlaceholder: 'Search memberships',
          search,
          onSearchChange: setSearch,
          primaryAction: {
            label: 'Add Membership',
            mobileLabel: 'Add',
            onClick: openCreate,
            // The caret only exists where there is somewhere to import FROM.
            // A single-location org would get a menu whose second item can
            // never do anything.
            menu: isMultiLocation
              ? {
                  items: [
                    { label: 'New membership plan', onSelect: openCreate },
                    {
                      label: 'Import from another location…',
                      onSelect: () => setImportOpen(true),
                    },
                  ],
                }
              : undefined,
          },
          isLoading,
          isError,
          errorMessage: error?.message ?? 'Failed to load membership plans',
          empty: {
            icon: BadgeCheck,
            title: search ? 'No matching memberships' : 'No memberships yet',
            description: search
              ? 'No membership matches that search.'
              : 'Create your first membership plan to start selling recurring or session-based packages.',
          },
        }}
      />

      <ImportMembershipPlansDialog
        onOpenChange={setImportOpen}
        open={importOpen}
      />

      <ConfirmDeleteDialog
        confirmLabel={sharedAcrossBranches ? 'Delete everywhere' : 'Delete'}
        description={
          sharedAcrossBranches
            ? 'This plan is sold at other locations too. Removing it here leaves it on sale for them; deleting withdraws it from every location. Memberships clients already hold keep working either way.'
            : 'If this plan has never been sold it will be permanently deleted. If clients already hold this membership, the plan is deactivated instead so existing memberships keep working — it will no longer be available for new sales.'
        }
        isPending={isDeleting || isRemoving}
        onConfirm={() => {
          if (deleteTarget) deleteMembershipPlan(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        open={!!deleteTarget}
        secondaryAction={
          sharedAcrossBranches && activeLocation
            ? {
                label: `Remove from ${branchLabel}`,
                onClick: () => {
                  if (!deleteTarget) return;
                  const target = deleteTarget;
                  setDeleteTarget(null);
                  // The hook surfaces the server's message, including the
                  // "last location" refusal an operator needs to read.
                  void removeMembershipPlanLocationAsync({
                    planId: target.id,
                    locationId: activeLocation.id,
                  }).catch(() => undefined);
                },
              }
            : undefined
        }
        title={<>Delete &ldquo;{deleteTarget?.name}&rdquo;?</>}
      />
    </>
  );
}
