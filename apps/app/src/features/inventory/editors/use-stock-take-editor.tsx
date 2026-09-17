'use client';

import { useResolvedRoutes } from '@/lib/use-routes';
import { useNavigate } from '@tanstack/react-router';
import { ClipboardList } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import type {
  EntityFormConfig,
  EntityFormValues,
} from '@/components/app/entity-editor';
import type { EntityEditorState } from '@/features/entity-editors/registry';
import { useListLocations } from '@/features/organization-locations';

import { createStockTakeForm, useCreateStockTake } from '../api';

/** Labels come from the form declaration — the contract locates by the same strings. */
const L = createStockTakeForm.labels;

/**
 * Stocktake create editor — CONFIG AND STATE ONLY, no layout.
 *
 * Lifted verbatim out of the old `StockTakeCreateDialog`: the same three
 * controls, the same "select a location" guard, and the same
 * `createStockTakeAsync` intent (name/description trimmed to `null`). Only the
 * chrome changed.
 *
 * There is no edit mode — a stocktake is counted, not re-described — so the
 * route only ever mounts this in create mode.
 */
export function useStockTakeEditor(): EntityEditorState {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const { locations } = useListLocations();
  const { createStockTakeAsync, isCreating } = useCreateStockTake();

  const [values, setValues] = useState(createStockTakeForm.defaults);

  // The dialog defaulted to the primary location as it opened; locations may
  // still be in flight when the page mounts, so seed it when they land.
  useEffect(() => {
    if (locations.length === 0) return;
    setValues((prev) => {
      if (prev.locationId) return prev;
      const primary = locations.find((l) => l.isPrimary) ?? locations[0];
      return primary ? { ...prev, locationId: primary.id } : prev;
    });
  }, [locations]);

  const setValue = useCallback(
    (name: string, value: unknown) =>
      setValues((prev) => ({ ...prev, [name]: value })),
    []
  );

  const config: EntityFormConfig = useMemo(
    () => ({
      title: () => 'New Stocktake',
      sections: [
        {
          id: 'details',
          label: 'Details',
          icon: ClipboardList,
          blocks: [
            {
              title: 'Stocktake Details',
              rows: [
                [
                  {
                    kind: 'select',
                    name: 'locationId',
                    label: L.locationId,
                    placeholder: 'Select location',
                    description:
                      'Counting snapshots every stock-tracked product at this location.',
                    options: locations.map((location) => ({
                      value: location.id,
                      label: location.name ?? 'Location',
                    })),
                  },
                ],
                [
                  {
                    kind: 'text',
                    name: 'name',
                    label: L.name,
                    placeholder: 'e.g. Monthly count (optional)',
                  },
                ],
                [
                  {
                    kind: 'textarea',
                    name: 'description',
                    label: L.description,
                    placeholder: 'Optional notes',
                  },
                ],
              ],
            },
          ],
        },
      ],
    }),
    [locations]
  );

  const onSave = useCallback(async () => {
    if (!values.locationId) {
      toast.error('Select a location');
      return;
    }
    try {
      // Typed intent; buildCreateStockTakePayload coalesces the blanks.
      const created = await createStockTakeAsync(values);
      // Counting is the point of creating one, so land on the list with the new
      // stocktake's count sheet already open — what the dialog did on success.
      await navigate({
        to: routes.inventoryStocktakes,
        search: { take: created.id },
      });
    } catch {
      // The hook already surfaces an error toast.
    }
  }, [values, createStockTakeAsync, navigate, routes.inventoryStocktakes]);

  return {
    config,
    values: values as unknown as EntityFormValues,
    setValue,
    isSaving: isCreating,
    onSave: () => void onSave(),
    onCancel: () => void navigate({ to: routes.inventoryStocktakes }),
  };
}
