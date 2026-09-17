'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { ImportFromLocationDialog } from '@/components/app/import-from-location';
import type { ImportFromLocationRow } from '@/components/app/import-from-location';
import { useActiveLocation } from '@/features/organization-locations';

import { useAddPractitionerLocations, useListPractitioners } from './api';

/**
 * "Add someone who works at another location…" for the Team page.
 *
 * The same shell the catalogue pages use, but the thing being shared is a
 * PERSON, not a record — so the copy says "works here" rather than "copies
 * land here", and the write is strictly additive: this dialog can put someone
 * on a second branch, never take them off the first.
 *
 * The per-member editor still owns the full picture (its Locations panel ticks
 * every branch at once). This is the bulk path a new branch actually needs:
 * "who from the rest of the business works here?"
 */
export function ImportTeamMembersDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { location: active, locations } = useActiveLocation();
  const { practitioners, isLoading, isError, error, refetch } =
    useListPractitioners();

  const sourceLocations = useMemo(
    () => locations.filter((l) => l.id !== active?.id).map(toOption),
    [locations, active?.id]
  );

  const [chosenLocationId, setChosenLocationId] = useState<string | null>(null);
  const sourceLocationId = chosenLocationId ?? sourceLocations[0]?.id ?? null;

  const { addPractitionerLocationsAsync, isAdding } =
    useAddPractitionerLocations();

  const rows: ImportFromLocationRow[] = useMemo(() => {
    if (!(sourceLocationId && active)) return [];

    return (
      practitioners
        .map((person) => ({
          person,
          // The list returns the join rows themselves, not a flat id array.
          branchIds: (person.locations ?? []).map((l) => l.locationId),
        }))
        // Works at the SOURCE branch specifically. Someone with no assignments
        // works everywhere — including here — so they are not missing from this
        // branch and are not a candidate.
        .filter(({ branchIds }) => branchIds.includes(sourceLocationId))
        .map(({ person, branchIds }) => ({
          id: person.id,
          name: person.name,
          // The email, not a job title: it is what tells two people with the
          // same first name apart in a list an admin is ticking through.
          meta: person.email,
          alreadyHere: branchIds.includes(active.id),
        }))
    );
  }, [practitioners, sourceLocationId, active]);

  const handleImport = async (ids: string[]) => {
    if (!active) return;

    const results = await Promise.allSettled(
      ids.map((practitionerId) =>
        addPractitionerLocationsAsync({
          practitionerId,
          locationIds: [active.id],
        })
      )
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    const added = ids.length - failed;
    const where = active.name ?? 'this location';

    if (added > 0) {
      toast.success(
        added === 1
          ? `1 team member now works at ${where}`
          : `${added} team members now work at ${where}`
      );
    }
    if (failed > 0) {
      toast.error(`${failed} could not be added`);
    }

    if (added > 0) onOpenChange(false);
  };

  return (
    <ImportFromLocationDialog
      confirmVerb="Add"
      description={`They keep one profile — adding them here means they can also be booked at ${active?.name ?? 'this location'}.`}
      entityPlural="team members"
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
      title="Add team members from another location"
    />
  );
}

/** A branch's display name — falls back to its address, as the switcher does. */
function toOption(location: {
  id: string;
  name: string | null;
  addressLine1: string;
}) {
  return { id: location.id, name: location.name ?? location.addressLine1 };
}
