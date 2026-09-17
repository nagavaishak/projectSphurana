import { db } from '@borradh-workspace/database';
import { getPrimaryLocation } from '@borradh-workspace/features/organizations';

/**
 * SERVER-side ad targeting resolution (register #82 / #116).
 *
 * HISTORY, because it explains the shape. This helper used to accept
 * model-supplied `latitude` / `longitude`, trust them unless they were within
 * ~1km of (0,0), and only then fall back to the org's geocoded address. That
 * guard existed because an ad had already run targeted at Null Island off West
 * Africa. The guard was the right patch and the wrong layer: the fix is to stop
 * accepting coordinates at all.
 *
 * So there is now exactly one source — the business's saved, geocoded branch,
 * the same one `resolveCampaignLocation` uses for the campaign — and the model
 * chooses only how far. A bad coordinate is no longer something to detect,
 * because it is no longer something anyone can express.
 *
 * When the org has no usable geocoded address we DON'T guess a country: the
 * override is left empty (so the ad inherits the campaign's targeting) and the
 * card carries an editable "no saved location" line. Never a hard stop — the
 * campaign it belongs to already refused, or already has geo.
 */
export interface AdTargetingInput {
  distanceKm?: number;
  ageMin?: number;
  ageMax?: number;
  genders?: number[];
  countries?: string[];
}

/** What actually goes to the createAd service: the knobs plus resolved geo. */
export interface ResolvedAdTargetingValues extends AdTargetingInput {
  latitude?: number;
  longitude?: number;
}

export interface ResolvedAdTargeting {
  /** The targeting to send to the createAd service. */
  targeting: ResolvedAdTargetingValues;
  /** One-line summary for the card (place + radius). */
  targetingDisplay: string;
  /**
   * Kept for the card's copy. `'user'` is no longer reachable — coordinates
   * cannot be supplied — but the card text still distinguishes "your saved
   * address" from "nothing on file".
   */
  coordSource: 'org' | 'none';
  /** True when no usable geo was found — the card shows the editable prompt and
   *  the ad inherits the campaign's targeting until the owner adds an address. */
  needsLocation: boolean;
}

/**
 * Coordinates within ~1km of (0,0) are never a real clinic. Nothing should be
 * able to produce them now that the only source is a Google geocode, so this
 * stays as an assertion rather than a filter — in lock-step with the identical
 * guard in `features/shared/build-meta-targeting.ts`.
 */
const isNearNullIsland = (lat: number, lng: number): boolean =>
  Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01;

export async function resolveAdTargeting(
  organizationId: string,
  input: AdTargetingInput
): Promise<ResolvedAdTargeting> {
  const targeting: ResolvedAdTargetingValues = { ...input };
  let coordSource: ResolvedAdTargeting['coordSource'] = 'none';
  let placeLabel: string | undefined;

  try {
    const loc = await getPrimaryLocation(db, { organizationId });
    if (
      loc.success &&
      loc.data &&
      loc.data.latitude != null &&
      loc.data.longitude != null &&
      !isNearNullIsland(loc.data.latitude, loc.data.longitude)
    ) {
      targeting.latitude = loc.data.latitude;
      targeting.longitude = loc.data.longitude;
      placeLabel = loc.data.label;
      coordSource = 'org';
    }
  } catch {
    // Best-effort — fall through to the no-location line below.
  }

  const radiusKm = targeting.distanceKm ?? 25;
  let targetingDisplay: string;
  let needsLocation = false;

  if (coordSource === 'org') {
    targetingDisplay = `Within ${radiusKm}km of ${placeLabel ?? 'your saved location'} (from your saved business address)`;
  } else {
    needsLocation = true;
    targetingDisplay =
      "No saved location yet — this ad will use the campaign's area. Add your business address in Settings to target around it.";
  }

  return { targeting, targetingDisplay, coordSource, needsLocation };
}
