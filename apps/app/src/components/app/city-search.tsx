import { Input } from '@/components/ui/input';
import { useRuntimeConfig } from '@borradh-workspace/runtime-config/client';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { useEffect, useRef, useState } from 'react';

let optionsSet = false;

export interface CitySearchResult {
  name: string;
  latitude: number;
  longitude: number;
}

export function CitySearch({
  onCitySelect,
}: {
  onCitySelect: (result: CitySearchResult) => void;
}) {
  const { googleMapsApiKey } = useRuntimeConfig();
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // The callback lives in a ref so the widget can be built ONCE.
  //
  // This used to be a `useCallback` dependency, which made the effect below
  // re-run whenever the caller passed a fresh function — and callers do:
  // `use-create-campaign-form.ts` declares `setLocation` in the hook body, so
  // it has a new identity on every render. Each re-run constructed another
  // `google.maps.places.Autocomplete`, and Google appends a `.pac-container`
  // dropdown to <body> per instance and never removes it. The result was a
  // growing stack of overlapping dropdowns (5–6 per screen), redundant Places
  // instances issuing their own billed requests, and clicks landing on a stale
  // container instead of the live one — which is how
  // `create-campaign.connected.spec.ts` failed with "subtree intercepts
  // pointer events" on its second run.
  //
  // Fixing it here rather than memoizing that one caller: any caller passing an
  // inline handler would reintroduce it, and nothing would say so.
  const onCitySelectRef = useRef(onCitySelect);
  useEffect(() => {
    onCitySelectRef.current = onCitySelect;
  });

  useEffect(() => {
    if (!googleMapsApiKey) return;

    let cancelled = false;

    (async () => {
      if (!inputRef.current) return;
      try {
        if (!optionsSet) {
          setOptions({ key: googleMapsApiKey, v: 'weekly' });
          optionsSet = true;
        }

        await importLibrary('places');
        if (cancelled || !inputRef.current) return;

        setIsLoaded(true);

        const autocomplete = new google.maps.places.Autocomplete(
          inputRef.current,
          {
            types: ['geocode'],
            fields: ['geometry', 'formatted_address', 'name'],
          }
        );

        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace();
          if (!place.geometry?.location) return;

          const lat = place.geometry.location.lat();
          const lng = place.geometry.location.lng();
          const name = place.formatted_address || place.name || '';

          onCitySelectRef.current({ name, latitude: lat, longitude: lng });

          // Clear the input after selection
          if (inputRef.current) inputRef.current.value = '';
        });

        autocompleteRef.current = autocomplete;
      } catch {
        // Google Maps not available
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

  if (!googleMapsApiKey) {
    return (
      <p className="text-sm text-muted-foreground">
        City search requires a Google Maps API key to be configured.
      </p>
    );
  }

  return (
    <Input
      ref={inputRef}
      placeholder={
        isLoaded ? 'Search for a city, town or area...' : 'Loading...'
      }
      disabled={!isLoaded}
    />
  );
}
