import { fetchWithRetry } from '@borradh-workspace/http';
import { logError } from '@borradh-workspace/observability';

export interface GeocodingResult {
  latitude: number;
  longitude: number;
}

/**
 * Geocode an address string using the Google Maps Geocoding API.
 * Returns lat/lng if successful, null if geocoding fails or no API key configured.
 */
export async function geocodeAddress(
  address: string
): Promise<GeocodingResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const trimmed = address.trim();
  if (!trimmed) return null;

  try {
    const params = new URLSearchParams({
      address: trimmed,
      key: apiKey,
    });

    const response = await fetchWithRetry(
      `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`,
      { timeoutMs: 10000 }
    );

    if (!response.ok) return null;

    const data = (await response.json()) as {
      status: string;
      results: Array<{
        geometry: {
          location: { lat: number; lng: number };
        };
      }>;
    };

    if (data.status !== 'OK' || !data.results[0]) return null;

    const { lat, lng } = data.results[0].geometry.location;
    return { latitude: lat, longitude: lng };
  } catch (err) {
    // Don't log the full address (PII); log only its length for context.
    logError('geocoding.geocodeAddress', err, {
      feature: 'geocoding',
      extra: { addressLength: trimmed.length },
    });
    return null;
  }
}
