import type { MetaTargeting } from '@borradh-workspace/database';

const EU_COUNTRY_CODES = new Set([
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
]);

// Rough EU bounding box (lat/lon)
const EU_BOUNDS = {
  latMin: 34.5, // Southern tip of Cyprus/Crete
  latMax: 71.2, // Northern Finland
  lonMin: -10.5, // Western Ireland/Portugal
  lonMax: 34.6, // Eastern Cyprus/Finland
};

/**
 * Check whether the campaign targeting includes any European locations.
 * Uses country codes if provided, otherwise falls back to lat/lon
 * bounding box check.
 */
export const targetingIncludesEU = (targeting: MetaTargeting): boolean => {
  if (targeting.countries?.length) {
    return targeting.countries.some((c) =>
      EU_COUNTRY_CODES.has(c.toUpperCase())
    );
  }

  if (targeting.latitude !== undefined && targeting.longitude !== undefined) {
    return (
      targeting.latitude >= EU_BOUNDS.latMin &&
      targeting.latitude <= EU_BOUNDS.latMax &&
      targeting.longitude >= EU_BOUNDS.lonMin &&
      targeting.longitude <= EU_BOUNDS.lonMax
    );
  }

  return false;
};
