import { describe, expect, it } from 'vitest';
import {
  buildMetaTargeting,
  isNearNullIsland,
} from './build-meta-targeting.js';

describe('buildMetaTargeting', () => {
  // Register #82: an ad ran targeted at lat/long (0,0) — Null Island, off the
  // West-African coast. Near-zero coordinates are invalid data and must be
  // dropped, never forwarded to Meta as a real place.
  it('drops near-(0,0) coordinates instead of targeting Null Island', () => {
    const result = buildMetaTargeting({
      latitude: 0,
      longitude: 0,
      distanceKm: 25,
    });
    expect(result.geo_locations).toBeUndefined();
  });

  it('isNearNullIsland flags (0,0) but not a real clinic', () => {
    expect(isNearNullIsland(0, 0)).toBe(true);
    expect(isNearNullIsland(0.005, -0.004)).toBe(true);
    expect(isNearNullIsland(53.35, -6.26)).toBe(false);
  });

  it('restricts a radius location to residents (location_types: home)', () => {
    const result = buildMetaTargeting({
      latitude: 53.35,
      longitude: -6.26,
      distanceKm: 25,
    });

    const geo = result.geo_locations as Record<string, unknown>;
    expect(geo.location_types).toEqual(['home']);
    expect(geo.custom_locations).toEqual([
      {
        latitude: 53.35,
        longitude: -6.26,
        radius: 25,
        distance_unit: 'kilometer',
      },
    ]);
  });

  it('restricts a country target to residents too', () => {
    const result = buildMetaTargeting({ countries: ['IE'] });
    const geo = result.geo_locations as Record<string, unknown>;
    expect(geo.countries).toEqual(['IE']);
    expect(geo.location_types).toEqual(['home']);
  });

  // Regression guard for the 2026-07 mis-targeting incident: buildMetaTargeting
  // must forward the caller's country VERBATIM and never invent a default. The
  // caller (create-campaign tool/service) owns anchoring on the ORG's country.
  // If anyone re-introduces a baked-in default here, these fail.
  it('forwards the caller-supplied country verbatim, injecting no default', () => {
    expect(
      (
        buildMetaTargeting({ countries: ['US'] }).geo_locations as {
          countries: string[];
        }
      ).countries
    ).toEqual(['US']);
    expect(
      (
        buildMetaTargeting({ countries: ['GB'] }).geo_locations as {
          countries: string[];
        }
      ).countries
    ).toEqual(['GB']);
  });

  it('emits no geo_locations when given neither coordinates nor countries', () => {
    // No silent country default — an empty geo target stays empty so the
    // caller/Zod schema is forced to supply a real anchor.
    expect(buildMetaTargeting({}).geo_locations).toBeUndefined();
  });
});
