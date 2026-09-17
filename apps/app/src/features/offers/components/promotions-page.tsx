/**
 * Promotions list, on the shared `ListPage`.
 *
 * Columns follow the design: Name, Offer, Used, Status, Code — status and code
 * render as a pill and a badge. There is no `useIsMobile` branch and no
 * `PromotionsMobileList` any more: the desktop table and the phone list render
 * from the SAME column config, so a column added here cannot silently fail to
 * reach the phone.
 *
 * "Scheduled" status is derived (active + validFrom > now); the backend does
 * not store it as a separate enum value.
 */

import { useNavigate } from '@tanstack/react-router';
import { BadgePercent, MoreVertical, Pencil, Trash2 } from 'lucide-react';
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
import { Progress } from '@/components/ui/progress';
import {
  isSharedAcrossBranches,
  useActiveLocation,
} from '@/features/organization-locations';
import { ImportPromotionsDialog } from '../import-promotions-dialog';

import { useDeleteOffer, useListOffers, useRemoveOfferLocation } from '../api';
import {
  type OfferListItem,
  StatusPill,
  deriveStatus,
  formatDiscount,
  num,
} from './promotions-shared';

export function PromotionsPage() {
  const { offers, isLoading, isError, error } = useListOffers({ limit: 100 });
  const {
    location: activeLocation,
    locations,
    isMultiLocation,
  } = useActiveLocation();
  const { removeOfferLocationAsync, isRemoving } = useRemoveOfferLocation();
  const [importOpen, setImportOpen] = useState(false);
  // Deleting a promotion USED to fire straight from the row menu with no
  // confirmation at all. It now goes through the shared destructive dialog —
  // which is also where the branch scope gets chosen, since one promotion can
  // run at several branches.
  const [deleteTarget, setDeleteTarget] = useState<OfferListItem | null>(null);
  const sharedAcrossBranches = isSharedAcrossBranches({
    locationIds: deleteTarget?.locationIds,
    totalBranches: locations.length,
  });
  const branchLabel =
    activeLocation?.name ?? activeLocation?.addressLine1 ?? 'this location';
  const { deleteOffer, isDeleting } = useDeleteOffer();

  const navigate = useNavigate();
  // Create and edit live on the SHARED editor routes (`/create/promotion`,
  // `/edit/promotion/:id`) — see features/entity-editors.
  const openCreate = () =>
    void navigate({ params: { entity: 'promotion' }, to: '/create/$entity' });
  const openEdit = (offer: OfferListItem) =>
    void navigate({
      params: { entity: 'promotion', id: offer.id },
      to: '/edit/$entity/$id',
    });

  const [search, setSearch] = useState('');

  // Filtering stays HERE, not in the shell: a promotion matches on its name OR
  // its code, which is this list's own notion of "matches".
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return offers;
    return offers.filter(
      (offer) =>
        offer.name.toLowerCase().includes(term) ||
        (offer.code?.toLowerCase().includes(term) ?? false)
    );
  }, [offers, search]);

  const columns: ListColumn<OfferListItem>[] = [
    {
      id: 'name',
      header: 'Name',
      mobile: 'primary',
      cell: (offer) => <span className="font-medium">{offer.name}</span>,
    },
    {
      id: 'offer',
      header: 'Offer',
      mobile: 'secondary',
      cell: (offer) => formatDiscount(offer),
    },
    {
      id: 'used',
      header: 'Used',
      width: 'w-[140px]',
      cell: (offer) => {
        const used = num(offer.redemptionCount) ?? 0;
        const cap = num(offer.redemptionLimit);
        return (
          <div>
            <div className="text-xs">
              {cap == null ? used : `${used}/${cap}`}
            </div>
            {cap != null && cap > 0 && (
              <Progress
                className="mt-1 h-1"
                value={Math.min(100, (used / cap) * 100)}
              />
            )}
          </div>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      mobile: 'trailing',
      cell: (offer) => <StatusPill status={deriveStatus(offer)} />,
    },
    {
      id: 'code',
      header: 'Code',
      cell: (offer) =>
        offer.code ? (
          <Badge className="font-mono text-xs" variant="outline">
            {offer.code}
          </Badge>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <>
      <title>Promotions | Borradh</title>

      <ListPage<OfferListItem>
        config={{
          title: 'Promotions',
          columns,
          rows,
          rowKey: (offer) => offer.id,
          onRowClick: openEdit,
          rowActions: (offer) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-label="Row actions" size="icon" variant="ghost">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEdit(offer)}>
                  <Pencil className="size-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  disabled={isDeleting}
                  onClick={() => setDeleteTarget(offer)}
                >
                  <Trash2 className="size-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
          searchPlaceholder: 'Search promotions...',
          search,
          onSearchChange: setSearch,
          primaryAction: {
            label: 'Add Promotion',
            mobileLabel: 'Add',
            onClick: openCreate,
            // The caret only exists where there is somewhere to import FROM.
            // A single-location org would get a menu whose second item can
            // never do anything.
            menu: isMultiLocation
              ? {
                  items: [
                    { label: 'New promotion', onSelect: openCreate },
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
          errorMessage: error?.message ?? 'Failed to load promotions',
          empty: {
            icon: BadgePercent,
            title: search ? 'No matching promotions' : 'No promotions yet',
            description: search
              ? 'No promotion matches that search.'
              : 'Create your first promotion to start discounting services.',
          },
        }}
      />
      <ImportPromotionsDialog onOpenChange={setImportOpen} open={importOpen} />

      <ConfirmDeleteDialog
        confirmLabel={sharedAcrossBranches ? 'Delete everywhere' : 'Delete'}
        description={
          sharedAcrossBranches
            ? 'This promotion runs at other locations too. Removing it here stops it at this location only; deleting ends it everywhere. Redemptions already taken are unaffected either way.'
            : 'This permanently deletes the promotion. Redemptions already taken are unaffected.'
        }
        isPending={isDeleting || isRemoving}
        onConfirm={() => {
          if (deleteTarget) deleteOffer(deleteTarget.id);
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
                  void removeOfferLocationAsync({
                    offerId: target.id,
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
