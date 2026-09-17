import { fetchWithRetry } from '@borradh-workspace/http';
import { trackedResult } from '@borradh-workspace/observability';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type SearchPlacesInput,
  searchPlacesSchema,
} from './search-places.schema.js';

export interface PlacePrediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

interface AutocompleteResponse {
  status: string;
  predictions: Array<{
    place_id: string;
    description: string;
    structured_formatting: {
      main_text: string;
      secondary_text: string;
    };
  }>;
}

const searchPlacesImpl = async (
  input: SearchPlacesInput
): Promise<Result<{ predictions: PlacePrediction[] }>> => {
  const parsed = searchPlacesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Google Maps API key not configured'
      )
    );
  }

  const params = new URLSearchParams({
    input: parsed.data.query,
    types: '(cities)',
    key: apiKey,
  });
  if (parsed.data.sessionToken) {
    params.set('sessiontoken', parsed.data.sessionToken);
  }

  const response = await fetchWithRetry(
    `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`
  );

  if (!response.ok) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Google Places API request failed'
      )
    );
  }

  const data = (await response.json()) as AutocompleteResponse;

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        `Google Places API error: ${data.status}`
      )
    );
  }

  const predictions: PlacePrediction[] = (data.predictions ?? []).map((p) => ({
    placeId: p.place_id,
    description: p.description,
    mainText: p.structured_formatting.main_text,
    secondaryText: p.structured_formatting.secondary_text,
  }));

  return ok({ predictions });
};

export const searchPlaces = (input: SearchPlacesInput) =>
  trackedResult('places.searchPlaces', () => searchPlacesImpl(input), {
    properties: { query: input.query },
  });
