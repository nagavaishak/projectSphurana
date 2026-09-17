import type { MetaTargeting } from '@borradh-workspace/database';

/**
 * Coordinates within ~1km of (0,0) — "Null Island", off West Africa — are never
 * a real clinic. They came from an ad launched at lat/long 0,0 (register #82),
 * so we treat any near-zero pair as INVALID and drop it rather than target the
 * Gulf of Guinea. `< 0.01°` ≈ 1.1km, tight enough to never reject a real place.
 */
const NULL_ISLAND_EPSILON = 0.01;

export const isNearNullIsland = (lat: number, lng: number): boolean =>
  Math.abs(lat) < NULL_ISLAND_EPSILON && Math.abs(lng) < NULL_ISLAND_EPSILON;

/**
 * Build Meta targeting spec from our targeting format.
 * Targeting is required and validated by Zod (must have lat/lng or countries).
 */
export const buildMetaTargeting = (targeting: MetaTargeting) => {
  const metaTargeting: Record<string, unknown> = {};
  const geoLocations: Record<string, unknown> = {};

  // Reject Null-Island coordinates: forwarding (0,0) is how an ad ran targeted
  // at the ocean off West Africa (register #82).
  const hasValidCoords =
    targeting.latitude !== undefined &&
    targeting.longitude !== undefined &&
    !isNearNullIsland(targeting.latitude, targeting.longitude);

  if (hasValidCoords) {
    geoLocations.custom_locations = [
      {
        latitude: targeting.latitude,
        longitude: targeting.longitude,
        radius: targeting.distanceKm || 25,
        distance_unit: 'kilometer',
      },
    ];
  }

  if (targeting.countries && targeting.countries.length > 0) {
    geoLocations.countries = targeting.countries;
  }

  if (Object.keys(geoLocations).length > 0) {
    // Target people who LIVE in the area only. Meta's default is
    // ['home','recent'] and it also expands to people merely "interested in
    // your selected cities and regions" ("Reach more people likely to respond
    // to your ads") — which broadens the audience well beyond the chosen area.
    // ['home'] pins targeting to residents and keeps that expansion off.
    geoLocations.location_types = ['home'];
    metaTargeting.geo_locations = geoLocations;
  }

  metaTargeting.age_min = targeting.ageMin || 18;
  metaTargeting.age_max = targeting.ageMax || 65;

  if (targeting.genders && targeting.genders.length > 0) {
    metaTargeting.genders = targeting.genders;
  }

  // Meta requires this flag to be explicitly set (advantage_audience: 0 = manual targeting)
  metaTargeting.targeting_automation = { advantage_audience: 0 };

  return metaTargeting;
};
