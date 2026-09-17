import { Check, ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';

import { useSetAssetService } from '@/features/assets';
import { useListServices } from '@/features/organization-services';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface AssetServiceComboboxProps {
  assetId: string;
  /** Services currently linked to the asset (from the list endpoint). */
  currentServices: { id: string; name: string }[];
}

/**
 * Change which service an uploaded asset is assigned to. Sets a SINGLE service
 * (unlinks any others), so the gallery badge + the batch planner's
 * per-service footage gating both reflect the choice. Shown in the media
 * preview for uploaded assets.
 */
export function AssetServiceCombobox({
  assetId,
  currentServices,
}: AssetServiceComboboxProps) {
  const { services, isLoading } = useListServices({ isActive: true });
  const { setService, isSettingService } = useSetAssetService();

  const [open, setOpen] = useState(false);
  // Local optimistic selection (the previewed item is a snapshot that doesn't
  // refetch); initialised from the asset's first linked service.
  const [selectedId, setSelectedId] = useState<string | null>(
    currentServices[0]?.id ?? null
  );

  const selected = services.find((s) => s.id === selectedId) ?? null;

  const handleSelect = (serviceId: string) => {
    setOpen(false);
    if (serviceId === selectedId) return;
    const previous = selectedId ?? currentServices[0]?.id ?? null;
    setSelectedId(serviceId);
    setService({
      assetId,
      serviceId,
      previousServiceIds: previous ? [previous] : [],
    });
  };

  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">Service</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={isSettingService}
            className="w-[220px] justify-between"
          >
            <span
              className={cn('truncate', !selected && 'text-muted-foreground')}
            >
              {selected
                ? selected.name
                : isLoading
                  ? 'Loading services…'
                  : 'Assign a service'}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[220px] p-0">
          <Command>
            <CommandInput placeholder="Search services…" />
            <CommandList>
              <CommandEmpty>No services found.</CommandEmpty>
              <CommandGroup>
                {services.map((service) => (
                  <CommandItem
                    key={service.id}
                    value={service.name}
                    onSelect={() => handleSelect(service.id)}
                  >
                    <Check
                      className={cn(
                        'mr-2 size-4',
                        selectedId === service.id ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    {service.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
