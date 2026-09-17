import { organizationLocation } from '@borradh-workspace/database';
import type { MetaTargeting } from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';
import { getPrimaryLocation } from '../../../organizations/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';

/**
 * A campaign's geo comes from a BRANCH, never from a typed address.
 *
 * WHY. Targeting used to accept raw `latitude` / `longitude` from whoever was
 * calling — and one of those callers is a language model, which is how an ad
 * once ran targeted at Null Island off West Africa (register #82), and how the
 * onboarding launcher's `countries: ['IE']` last resort sent US and UK spend to
 * Ireland. Guards were added downstream for both. This removes the input that
 * needed guarding: a campaign names a branch, and the branch's geocoded
 * coordinates — the ones `createLocation` / `updateLocation` maintain against
 * Google — are the only ones that reach Meta.
 *
 * The branch is also what makes the rest of the location work possible: the
 * same field decides the ad's landing page and which branch a conversation
 * started from that ad belongs to.
 */

/** Resolved branch, ready to fold into a `MetaTargeting`. */
export interface CampaignLocation {
  id: string;
  /** Display label, e.g. "Pelham Street, Stoke on Trent". */
  label: string;
  country: string;
  /**
   * Null only for a branch that has never geocoded. That is fatal for a radius
   * campaign and harmless for a national one — see `requireCoordinates`.
   */
  latitude: number | null;
  longitude: number | null;
}

/**
 * Coordinates within ~1km of (0,0) are never a real clinic. The branch's
 * coordinates come from Google, so this should be unreachable — it stays as a
 * cheap assertion that a bad geocode never becomes ad spend, matching the
 * backstop in `build-meta-targeting.ts`.
 */
const isNearNullIsland = (lat: number, lng: number): boolean =>
  Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01;

/**
 * The branch a campaign targets.
 *
 * `locationId` given → that branch, scoped to the org (a foreign id is a
 * NOT_FOUND, never a silent fallback to someone else's address).
 * `locationId` omitted → the org's default branch, via `getPrimaryLocation`
 * rather than a fifth hand-written "which one is primary" ordering.
 *
 * Returns VALIDATION_ERROR when the resolved branch has no usable coordinates.
 * That is deliberately a hard stop with an actionable message: guessing a
 * country is how the `['IE']` bug happened, and spending money on the wrong
 * area is worse than refusing to start.
 */
export const resolveCampaignLocation = async (
  db: DbConnection,
  input: {
    organizationId: string;
    locationId?: string;
    /**
     * True for a RADIUS campaign, where a branch we cannot place on a map is a
     * campaign we cannot target. False for a NATIONAL campaign (`countries`),
     * which needs the branch only for attribution and its landing page — a
     * clinic advertising to a whole country should not be blocked because its
     * street address never geocoded.
     */
    requireCoordinates: boolean;
  }
): Promise<Result<CampaignLocation>> => {
  const { organizationId, locationId, requireCoordinates } = input;

  if (locationId) {
    const row = await db.query.organizationLocation.findFirst({
      where: and(
        eq(organizationLocation.id, locationId),
        eq(organizationLocation.organizationId, organizationId)
      ),
    });

    if (!row) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          'That location does not belong to this organisation.'
        )
      );
    }

    return toCampaignLocation(
      {
        id: row.id,
        label: locationLabel(row.addressLine1, row.city),
        country: row.country,
        latitude: row.latitude,
        longitude: row.longitude,
      },
      requireCoordinates
    );
  }

  const primary = await getPrimaryLocation(db, { organizationId });
  // Re-wrap rather than forward: `trackedResult` widens the error to a plain
  // shape, and this function's callers expect a `FeatureError`.
  if (!primary.success) {
    return err(
      new FeatureError(
        primary.error.code,
        primary.error.message,
        primary.error.details
      )
    );
  }
  if (!primary.data) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'This business has no location saved yet. Add your address in Settings, then create the campaign.'
      )
    );
  }

  return toCampaignLocation(primary.data, requireCoordinates);
};

const toCampaignLocation = (
  row: {
    id: string;
    label: string;
    country: string;
    latitude: number | null;
    longitude: number | null;
  },
  requireCoordinates: boolean
): Result<CampaignLocation> => {
  const placed =
    row.latitude != null &&
    row.longitude != null &&
    !isNearNullIsland(row.latitude, row.longitude);

  if (!placed && requireCoordinates) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        `We could not place "${row.label}" on the map, so we cannot target ads around it. Open Location Settings and set the address again.`,
        { locationId: row.id }
      )
    );
  }

  return ok({
    id: row.id,
    label: row.label,
    country: row.country,
    latitude: placed ? row.latitude : null,
    longitude: placed ? row.longitude : null,
  });
};

/** Same shape `getPrimaryLocation` produces, for the by-id branch above. */
const locationLabel = (addressLine1: string, city: string): string =>
  [addressLine1, city].filter(Boolean).join(', ') || city || addressLine1;

/**
 * Fold a resolved branch into the targeting that goes to Meta.
 *
 * The caller supplies only the knobs a human actually chooses — how far, what
 * ages, which genders, or a country list. `location` is a DERIVED label (the
 * campaign review slide and Claire's preview card both display it); it is never
 * an input.
 *
 * Coordinates are omitted when the branch has none, which only happens in
 * national mode — `buildMetaTargeting` then emits `geo_locations.countries`
 * alone, exactly as it did before.
 */
export const buildTargetingForLocation = (
  location: CampaignLocation,
  knobs: Omit<MetaTargeting, 'location' | 'latitude' | 'longitude'> = {}
): MetaTargeting => ({
  ...knobs,
  location: location.label,
  ...(location.latitude != null &&
    location.longitude != null && {
      latitude: location.latitude,
      longitude: location.longitude,
    }),
});
