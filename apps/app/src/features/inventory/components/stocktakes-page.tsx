import type { StockTake } from '@borradh-workspace/api-client/types';
import { useNavigate } from '@tanstack/react-router';
import { ClipboardList } from 'lucide-react';
import { useState } from 'react';

import { ListPage } from '@/components/app/list-page';
import type { ListColumn } from '@/components/app/list-page';
import { useListLocations } from '@/features/organization-locations';

import { useListStockTakes } from '../api';
import { StockTakeStatusBadge } from './status-badges';
import { StockTakeCountDialog } from './stock-take-count-dialog';

/**
 * Stocktakes, on the shared `ListPage`.
 *
 * `StocktakesMobileList` is gone — the phone list is the same column config the
 * table renders.
 *
 * A row opens the COUNT SHEET, not `/edit/stock-take/:id`: the stock-take entity
 * editor is deliberately create-only (see `entity-editors/definitions`), and
 * counting is what editing a stocktake means.
 */
export function StocktakesPage({
  /**
   * Set by the route from `?take=`, so the editor can land here with the
   * stocktake it just started already open for counting — what the create
   * DIALOG did directly, before create moved to its own page.
   */
  initialStockTakeId,
}: { initialStockTakeId?: string } = {}) {
  const { stockTakes, isLoading, isError, error } = useListStockTakes();
  const { locations } = useListLocations();

  const navigate = useNavigate();
  const openCreate = () =>
    void navigate({ params: { entity: 'stock-take' }, to: '/create/$entity' });
  const [detailId, setDetailId] = useState<string | null>(
    initialStockTakeId ?? null
  );

  const locationName = (id: string | null) =>
    id ? (locations.find((l) => l.id === id)?.name ?? '—') : '—';

  const columns: ListColumn<StockTake>[] = [
    {
      cell: (take) => (
        <span className="font-medium">{take.name || 'Untitled stocktake'}</span>
      ),
      header: 'Name',
      id: 'name',
      mobile: 'primary',
    },
    {
      cell: (take) => locationName(take.locationId),
      header: 'Location',
      id: 'location',
      mobile: 'secondary',
    },
    {
      cell: (take) => new Date(take.createdAt).toLocaleDateString(),
      header: 'Created',
      id: 'created',
    },
    {
      cell: (take) => <StockTakeStatusBadge status={take.status} />,
      header: 'Status',
      id: 'status',
      mobile: 'trailing',
    },
  ];

  return (
    <>
      <title>Stocktakes | Borradh</title>

      <ListPage<StockTake>
        config={{
          columns,
          empty: {
            description:
              'Start a stocktake to count stock and correct any discrepancies.',
            icon: ClipboardList,
            title: 'No stocktakes yet',
          },
          errorMessage: error?.message ?? 'Failed to load stocktakes',
          isError,
          isLoading,
          primaryAction: {
            label: 'New stocktake',
            mobileLabel: 'New',
            onClick: openCreate,
          },
          rowKey: (take) => take.id,
          onRowClick: (take) => setDetailId(take.id),
          rows: stockTakes,
          title: 'Stocktakes',
        }}
      />

      <StockTakeCountDialog
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        stockTakeId={detailId}
      />
    </>
  );
}
