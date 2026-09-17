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
  type GetPlaceDetailsInput,
  getPlaceDetailsSchema,
} from './get-place-details.schema.js';

export interface PlaceDetailsResult {
  name: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
}

interface DetailsResponse {
  status: string;
  result: {
    name: string;
    formatted_address: string;
    geometry: {
      location: { lat: number; lng: number };
    };
  };
}

const getPlaceDetailsImpl = async (
  input: GetPlaceDetailsInput
): Promise<Result<PlaceDetailsResult>> => {
  const parsed = getPlaceDetailsSchema.safeParse(input);
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
    place_id: parsed.data.placeId,
    fields: 'geometry,name,formatted_address',
    key: apiKey,
  });
  if (parsed.data.sessionToken) {
    params.set('sessiontoken', parsed.data.sessionToken);
  }

  const response = await fetchWithRetry(
    `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`
  );

  if (!response.ok) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Google Places API request failed'
      )
    );
  }

  const data = (await response.json()) as DetailsResponse;

  if (data.status !== 'OK' || !data.result) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Place not found'));
  }

  const { lat, lng } = data.result.geometry.location;

  return ok({
    name: data.result.name,
    formattedAddress: data.result.formatted_address,
    latitude: lat,
    longitude: lng,
  });
};

export const getPlaceDetails = (input: GetPlaceDetailsInput) =>
  trackedResult('places.getPlaceDetails', () => getPlaceDetailsImpl(input), {
    properties: { placeId: input.placeId },
  });
