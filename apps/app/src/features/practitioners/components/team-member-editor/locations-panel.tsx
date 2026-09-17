import { Loader2 } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';

import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useListLocations } from '@/features/organization-locations';

import { type TeamMemberFormValues, teamMemberForm } from './types';

/** Labels come from the form declaration — see `profile-panel.tsx`. */
const L = teamMemberForm.labels;

interface LocationsPanelProps {
  form: UseFormReturn<TeamMemberFormValues>;
}

export function LocationsPanel({ form }: LocationsPanelProps) {
  const { locations, isLoading, isError } = useListLocations();
  const selected = form.watch('locationIds');

  const toggle = (id: string, checked: boolean) => {
    if (checked) {
      if (!selected.includes(id))
        form.setValue('locationIds', [...selected, id], { shouldDirty: true });
    } else {
      form.setValue(
        'locationIds',
        selected.filter((lid) => lid !== id),
        { shouldDirty: true }
      );
    }
  };

  return (
    // Marked so a test can scope to THIS panel's checkboxes: the editor keeps
    // every section mounted, so an unscoped checkbox query reaches the
    // Services panel too.
    <div className="flex max-w-2xl flex-col gap-4" data-locations-panel="">
      <div>
        <h3 className="text-lg font-semibold">{L.locationIds}</h3>
        <p className="text-sm text-muted-foreground">
          Select the locations this team member works at.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center text-sm text-destructive">
          Failed to load locations.
        </div>
      ) : locations.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No locations yet. Add a location in settings first.
        </div>
      ) : (
        <div className="flex flex-col rounded-lg border">
          {locations.map((location) => (
            // biome-ignore lint/a11y/noLabelWithoutControl: label wraps a Radix Checkbox (renders a button, not a native input), so implicit association isn't statically detected
            <label
              key={location.id}
              className="flex cursor-pointer items-center gap-3 border-b px-3 py-3 last:border-b-0 hover:bg-muted/40"
            >
              <Checkbox
                checked={selected.includes(location.id)}
                onCheckedChange={(v) => toggle(location.id, v === true)}
                aria-label={location.name ?? location.addressLine1 ?? undefined}
              />
              <span className="flex flex-1 flex-col">
                <span className="font-medium">
                  {location.name?.trim() ||
                    location.addressLine1 ||
                    'Unnamed location'}
                </span>
                {(location.addressLine1 || location.city) && (
                  <span className="text-xs text-muted-foreground">
                    {[location.addressLine1, location.city]
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                )}
              </span>
              {location.isPrimary && <Badge variant="secondary">Primary</Badge>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
