import {
  AddressAutocomplete,
  type AddressResult,
} from '@/components/ui/address-autocomplete';
import {
  AppDialogBody,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogRoot,
} from '@/components/ui/app-dialog';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { FieldError, FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { Check, ChevronsUpDown, MapPin, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { type CountryCode, countryCodeValues } from '../country-codes';

interface Step6LocationsProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
}

const emptyLocation = {
  name: '',
  addressLine1: '',
  city: '',
  county: '',
  postalCode: '',
  country: '',
  latitude: null as number | null,
  longitude: null as number | null,
};

/**
 * Step 6: Locations
 * Dedicated step for managing business locations.
 */
export function Step6Locations({ form }: Step6LocationsProps) {
  const locations: Array<{
    id: string;
    name?: string;
    addressLine1: string;
    city: string;
    county?: string;
    postalCode?: string;
    country: string;
    latitude?: number | null;
    longitude?: number | null;
  }> = form.watch('locations') || [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [isManualEntry, setIsManualEntry] = useState(false);
  const [newLocation, setNewLocation] = useState({ ...emptyLocation });

  const handleRemoveLocation = (id: string) => {
    const current = form.getValues('locations') || [];
    form.setValue(
      'locations',
      current.filter((loc: { id: string }) => loc.id !== id)
    );
  };

  const handlePlaceSelect = (place: AddressResult) => {
    setNewLocation({
      ...newLocation,
      addressLine1: place.addressLine1,
      city: place.city,
      county: place.county,
      postalCode: place.postalCode,
      country: place.country,
      latitude: place.latitude,
      longitude: place.longitude,
    });
  };

  const handleAddLocation = () => {
    if (
      !newLocation.addressLine1.trim() ||
      !newLocation.city.trim() ||
      !newLocation.country.trim()
    ) {
      return;
    }
    const current = form.getValues('locations') || [];
    form.setValue('locations', [
      ...current,
      {
        id: crypto.randomUUID(),
        name: newLocation.name.trim() || undefined,
        addressLine1: newLocation.addressLine1.trim(),
        addressLine2: '',
        city: newLocation.city.trim(),
        county: newLocation.county.trim() || undefined,
        postalCode: newLocation.postalCode.trim() || undefined,
        country: newLocation.country.trim().toLowerCase(),
        isPrimary: current.length === 0,
        latitude: newLocation.latitude,
        longitude: newLocation.longitude,
      },
    ]);
    setNewLocation({ ...emptyLocation });
    setIsManualEntry(false);
    setDialogOpen(false);
  };

  const openDialog = () => {
    setNewLocation({ ...emptyLocation });
    setIsManualEntry(false);
    setDialogOpen(true);
  };

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Your Locations</h1>
        <p className="text-muted-foreground">
          Add your business locations. You can always update these later.
        </p>
      </div>

      <Controller
        name="locations"
        control={form.control}
        render={({ fieldState }) => (
          <>
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </>
        )}
      />

      {locations.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MapPin />
            </EmptyMedia>
            <EmptyTitle>No locations added</EmptyTitle>
            <EmptyDescription>
              Add your first business location to get started.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" onClick={openDialog}>
              <Plus className="h-4 w-4" />
              Add a location
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {locations.map((loc) => (
              <div
                key={loc.id}
                data-testid="location-entry"
                className="flex items-start justify-between rounded-md border p-3"
              >
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="text-sm">
                    {loc.name && <p className="font-medium">{loc.name}</p>}
                    <p className="text-muted-foreground">
                      {[
                        loc.addressLine1,
                        loc.city,
                        loc.county,
                        loc.postalCode,
                        countryCodeValues[
                          loc.country?.toUpperCase() as CountryCode
                        ] || loc.country?.toUpperCase(),
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => handleRemoveLocation(loc.id)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={openDialog}
          >
            <Plus className="h-4 w-4" />
            Add another location
          </Button>
        </>
      )}

      <AppDialogRoot open={dialogOpen} onOpenChange={setDialogOpen} size="md">
        <AppDialogHeader
          title="Add a location"
          description="Search for your address or enter it manually."
          icon={MapPin}
        />
        <AppDialogBody className="flex flex-col gap-3">
          <Input
            placeholder="Location name (optional)"
            value={newLocation.name}
            onChange={(e) =>
              setNewLocation((prev) => ({ ...prev, name: e.target.value }))
            }
          />

          {!isManualEntry ? (
            <>
              <AddressAutocomplete
                onPlaceSelect={handlePlaceSelect}
                placeholder="Search for an address..."
                onManualEntry={() => setIsManualEntry(true)}
              />
              {/* Show filled fields as read-only preview when autocomplete has been used */}
              {newLocation.addressLine1 && (
                <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
                  <p>
                    <span className="text-muted-foreground">Street:</span>{' '}
                    {newLocation.addressLine1}
                  </p>
                  <p>
                    <span className="text-muted-foreground">City:</span>{' '}
                    {newLocation.city}
                  </p>
                  {newLocation.county && (
                    <p>
                      <span className="text-muted-foreground">County:</span>{' '}
                      {newLocation.county}
                    </p>
                  )}
                  {newLocation.postalCode && (
                    <p>
                      <span className="text-muted-foreground">
                        Postal Code:
                      </span>{' '}
                      {newLocation.postalCode}
                    </p>
                  )}
                  {newLocation.country && (
                    <p>
                      <span className="text-muted-foreground">Country:</span>{' '}
                      {countryCodeValues[
                        newLocation.country.toUpperCase() as CountryCode
                      ] || newLocation.country.toUpperCase()}
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <Input
                placeholder="Street address *"
                value={newLocation.addressLine1}
                onChange={(e) =>
                  setNewLocation((prev) => ({
                    ...prev,
                    addressLine1: e.target.value,
                  }))
                }
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  placeholder="City *"
                  value={newLocation.city}
                  onChange={(e) =>
                    setNewLocation((prev) => ({
                      ...prev,
                      city: e.target.value,
                    }))
                  }
                />
                <Input
                  placeholder="County / State"
                  value={newLocation.county}
                  onChange={(e) =>
                    setNewLocation((prev) => ({
                      ...prev,
                      county: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  placeholder="Postal code"
                  value={newLocation.postalCode}
                  onChange={(e) =>
                    setNewLocation((prev) => ({
                      ...prev,
                      postalCode: e.target.value,
                    }))
                  }
                />
                <Popover open={countryOpen} onOpenChange={setCountryOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(
                        'w-full justify-between font-normal',
                        !newLocation.country && 'text-muted-foreground'
                      )}
                    >
                      {newLocation.country
                        ? countryCodeValues[
                            newLocation.country.toUpperCase() as CountryCode
                          ] || newLocation.country
                        : 'Country *'}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                    <Command>
                      <CommandInput placeholder="Search country..." />
                      <CommandList>
                        <CommandEmpty>No country found.</CommandEmpty>
                        <CommandGroup>
                          {Object.entries(countryCodeValues).map(
                            ([code, name]) => (
                              <CommandItem
                                key={code}
                                value={`${name} ${code}`}
                                onSelect={() => {
                                  setNewLocation((prev) => ({
                                    ...prev,
                                    country: code.toLowerCase(),
                                  }));
                                  setCountryOpen(false);
                                }}
                              >
                                <Check
                                  className={cn(
                                    'mr-2 h-4 w-4',
                                    newLocation.country.toUpperCase() === code
                                      ? 'opacity-100'
                                      : 'opacity-0'
                                  )}
                                />
                                {name}
                                <span className="ml-auto text-xs text-muted-foreground">
                                  {code}
                                </span>
                              </CommandItem>
                            )
                          )}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <button
                type="button"
                className="text-xs text-muted-foreground underline"
                onClick={() => setIsManualEntry(false)}
              >
                Search for address instead
              </button>
            </>
          )}
        </AppDialogBody>
        <AppDialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setDialogOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleAddLocation}
            disabled={
              !newLocation.addressLine1.trim() ||
              !newLocation.city.trim() ||
              !newLocation.country.trim()
            }
          >
            Add location
          </Button>
        </AppDialogFooter>
      </AppDialogRoot>
    </FieldGroup>
  );
}
