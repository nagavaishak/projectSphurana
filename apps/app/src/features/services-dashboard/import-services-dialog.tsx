'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { ImportFromLocationDialog } from '@/components/app/import-from-location';
import type { ImportFromLocationRow } from '@/components/app/import-from-location';
import { useActiveLocation } from '@/features/organization-locations';
import { useListServices } from '@/features/organization-services';
import { useAddServiceLocations } from '@/features/organization-services';
import { useOrgCurrency } from '@/hooks/use-org-currency';
import { servicePriceTypeLabels } from '@borradh-workspace/labels';

/**
 * "Import from another location…" for the service catalogue.
 *
 * The adapter, not the shell: it turns services into rows and a selection into
 * writes, and knows nothing about how the dialog looks.
 *
 * WHY NO EXTRA FETCH. `listServices` already returns `locationIds` per service,
 * so "offered at Rathmines but not here" is a filter over the catalogue the
 * page has loaded, not a second endpoint. Note the convention that makes this
 * read correctly: EMPTY `locationIds` MEANS EVERY BRANCH — such a service is
 * already offered here, so it is never a candidate. That is also why an org
 * that has never assigned a branch sees an empty dialog rather than its whole
 * catalogue: nothing is missing from this branch.
 */
export function ImportServicesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { location: active, locations } = useActiveLocation();
  const { services, isLoading, isError, error, refetch } = useListServices();
  const { format } = useOrgCurrency();

  const sourceLocations = useMemo(
    () => locations.filter((l) => l.id !== active?.id).map(toOption),
    [locations, active?.id]
  );

  // The chosen branch, or the first one once the list arrives.
  //
  // NOT `useState(sourceLocations[0]?.id)`: lazy initial state is evaluated on
  // the FIRST render, when `useActiveLocation` is still loading and the list is
  // empty — so the picker would read "Choose a location" forever and the dialog
  // would show nothing to import.
  const [chosenLocationId, setChosenLocationId] = useState<string | null>(null);
  const sourceLocationId = chosenLocationId ?? sourceLocations[0]?.id ?? null;

  const { addServiceLocationsAsync, isAdding } = useAddServiceLocations();

  const rows: ImportFromLocationRow[] = useMemo(() => {
    if (!(sourceLocationId && active)) return [];

    return (
      services
        // Offered at the SOURCE branch specifically. A service with no
        // assignments is offered everywhere — including here — so it is not
        // something this branch is missing.
        // `?? []` is not defensive noise: a stale API build that strips
        // `locationIds` used to take the whole page down with it here, and []
        // degrades to "offered everywhere" — which hides the row from import
        // rather than offering a copy that might be wrong.
        .filter((service) =>
          (service.locationIds ?? []).includes(sourceLocationId)
        )
        .map((service) => ({
          id: service.id,
          name: service.name,
          meta: service.appointmentDuration
            ? `${service.appointmentDuration} min`
            : undefined,
          trailing:
            service.priceCents == null
              ? servicePriceTypeLabels[service.priceType]
              : format(service.priceCents),
          alreadyHere: (service.locationIds ?? []).includes(active.id),
        }))
    );
  }, [services, sourceLocationId, active, format]);

  const handleImport = async (ids: string[]) => {
    if (!active) return;

    // One request per service: the endpoint is per-resource, and a partial
    // failure should still leave the successful copies in place rather than
    // rolling back work the user can see happened.
    const results = await Promise.allSettled(
      ids.map((serviceId) =>
        addServiceLocationsAsync({ serviceId, locationIds: [active.id] })
      )
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    const added = ids.length - failed;

    if (added > 0) {
      toast.success(
        added === 1
          ? `1 service added to ${active.name ?? 'this location'}`
          : `${added} services added to ${active.name ?? 'this location'}`
      );
    }
    // The mutation's own onError already toasted each failure; this is the
    // count, so a partial success is not silently read as a full one.
    if (failed > 0) {
      toast.error(`${failed} could not be imported`);
    }

    if (added > 0) onOpenChange(false);
  };

  return (
    <ImportFromLocationDialog
      entityPlural="services"
      errorMessage={error?.message}
      isError={isError}
      isImporting={isAdding}
      isLoading={isLoading}
      onImport={handleImport}
      onOpenChange={onOpenChange}
      onRetry={() => refetch()}
      onSourceLocationChange={setChosenLocationId}
      open={open}
      rows={rows}
      sourceLocationId={sourceLocationId}
      sourceLocations={sourceLocations}
      targetLocationName={active?.name ?? 'this location'}
      title="Import services"
    />
  );
}

/** A branch's display name — falls back to its address line, as the switcher does. */
function toOption(location: {
  id: string;
  name: string | null;
  addressLine1: string;
}) {
  return { id: location.id, name: location.name ?? location.addressLine1 };
}
