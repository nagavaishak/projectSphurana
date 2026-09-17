import type { ClinicAreaType } from '@borradh-workspace/labels';

/**
 * Neutral default radius (km) used when the clinic's area type is unknown.
 * Matches the long-standing campaign default so behaviour is unchanged for
 * orgs that never answered the city-vs-countryside question.
 */
export const DEFAULT_TARGETING_RADIUS_KM = 25;

/**
 * Default ad-targeting radius for a clinic's geographic catchment.
 *
 *   - `city`        → 20km. Dense area, a clinic on every corner; people won't
 *                     travel far, so a tight radius keeps spend on the people
 *                     who'll actually show up.
 *   - `countryside` → 40km. Sparse area; people expect to drive, so the
 *                     catchment has to reach further to find enough audience.
 *   - unset/null    → 25km neutral default (the historical value).
 *
 * The owner can still override the radius per campaign; this only sets the
 * default Claire proposes in the preview.
 */
export const targetingRadiusKmForAreaType = (
  areaType: ClinicAreaType | null | undefined
): number => {
  switch (areaType) {
    case 'city':
      return 20;
    case 'countryside':
      return 40;
    default:
      return DEFAULT_TARGETING_RADIUS_KM;
  }
};
