import { Input } from '@/components/ui/input';
import { useRuntimeConfig } from '@borradh-workspace/runtime-config/client';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { useEffect, useRef, useState } from 'react';

export interface AddressResult {
  addressLine1: string;
  city: string;
  county: string;
  postalCode: string;
  country: string; // 2-letter code lowercase
  latitude: number | null;
  longitude: number | null;
}

interface AddressAutocompleteProps {
  onPlaceSelect: (place: AddressResult) => void;
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Show manual entry fallback link */
  onManualEntry?: () => void;
}

let optionsSet = false;

/**
 * Extract structured address components from a Google Places result.
 */
function extractAddressComponents(
  place: google.maps.places.PlaceResult
): AddressResult {
  const components = place.address_components ?? [];
  const get = (type: string): string =>
    components.find((c: google.maps.GeocoderAddressComponent) =>
      c.types.includes(type)
    )?.long_name ?? '';
  const getShort = (type: string): string =>
    components.find((c: google.maps.GeocoderAddressComponent) =>
      c.types.includes(type)
    )?.short_name ?? '';

  // Street number + route = street address
  const streetNumber = get('street_number');
  const route = get('route');
  const addressLine1 = [streetNumber, route].filter(Boolean).join(' ');

  const city =
    get('locality') ||
    get('postal_town') ||
    get('sublocality_level_1') ||
    get('administrative_area_level_2');
  const county = get('administrative_area_level_1');
  const postalCode = get('postal_code');
  const country = getShort('country').toLowerCase();

  const lat = place.geometry?.location?.lat() ?? null;
  const lng = place.geometry?.location?.lng() ?? null;

  return {
    addressLine1: addressLine1 || place.formatted_address?.split(',')[0] || '',
    city,
    county,
    postalCode,
    country,
    latitude: lat,
    longitude: lng,
  };
}

export function AddressAutocomplete({
  onPlaceSelect,
  defaultValue = '',
  placeholder = 'Search for an address...',
  disabled = false,
  onManualEntry,
}: AddressAutocompleteProps) {
  const { googleMapsApiKey } = useRuntimeConfig();
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [inputValue, setInputValue] = useState(defaultValue);
  const [isLoaded, setIsLoaded] = useState(false);

  // The callback lives in a ref so the widget is built ONCE — see the longer
  // note in components/app/city-search.tsx. Depending on `onPlaceSelect`
  // rebuilt the Autocomplete on every render for any caller passing an inline
  // handler, and Google appends a `.pac-container` per instance to <body> and
  // never removes it: overlapping dropdowns, redundant billed Places requests,
  // and clicks landing on a stale container.
  const onPlaceSelectRef = useRef(onPlaceSelect);
  useEffect(() => {
    onPlaceSelectRef.current = onPlaceSelect;
  });

  useEffect(() => {
    if (!googleMapsApiKey) return;

    let cancelled = false;

    (async () => {
      if (!inputRef.current) return;
      try {
        if (!optionsSet) {
          setOptions({
            key: googleMapsApiKey,
            v: 'weekly',
          });
          optionsSet = true;
        }

        await importLibrary('places');
        if (cancelled || !inputRef.current) return;

        setIsLoaded(true);

        const autocomplete = new google.maps.places.Autocomplete(
          inputRef.current,
          {
            types: ['address'],
            fields: ['address_components', 'geometry', 'formatted_address'],
          }
        );

        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace();
          if (!place.address_components) return;
          const result = extractAddressComponents(place);
          setInputValue(place.formatted_address ?? '');
          onPlaceSelectRef.current(result);
        });

        autocompleteRef.current = autocomplete;
      } catch {
        // Google Maps not available — user can use manual entry
      }
    })();

    return () => {
      cancelled = true;
      if (autocompleteRef.current) {
        google.maps.event.clearInstanceListeners(autocompleteRef.current);
        autocompleteRef.current = null;
      }
    };
  }, [googleMapsApiKey]);

  // If no API key, just render a plain text input
  if (!googleMapsApiKey) {
    return (
      <div className="space-y-1">
        <Input
          placeholder={placeholder}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          disabled={disabled}
        />
        {onManualEntry && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={onManualEntry}
          >
            Enter address manually
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Input
        ref={inputRef}
        placeholder={isLoaded ? placeholder : 'Loading...'}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        disabled={disabled || !isLoaded}
      />
      {onManualEntry && (
        <button
          type="button"
          className="text-xs text-muted-foreground underline"
          onClick={onManualEntry}
        >
          Enter address manually
        </button>
      )}
    </div>
  );
}
