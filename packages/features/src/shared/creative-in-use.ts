import { metaAd } from '@borradh-workspace/database';
import { and, eq, or } from 'drizzle-orm';
import { ErrorCodes, FeatureError } from './core/errors.js';
import type { DbConnection } from './core/types.js';

/** How many referencing ads to name before summarising the rest. */
const NAMES_SHOWN = 3;

/**
 * Refuse to delete a creative that an ad still points at.
 *
 * Deleting a graphic hard-deletes the row AND destroys its S3 objects, and
 * deleting a video did the same historically. Neither checked for a
 * referencing `metaAd`, so a creative could be removed out from under an ad
 * that had already launched — leaving a `videoId` pointing at nothing, media
 * that cannot be recovered, and a duplicate of that ad that can never publish.
 * Four production ads across three organisations ended up in that state.
 *
 * Both creative columns are checked because `metaAd.videoId` is polymorphic:
 * it holds a `video.id`, an `asset.id`, or (historically) a graphic id, while
 * `graphicId` is the modern home for image creatives.
 *
 * @returns a CONFLICT error naming the ads, or null when the delete is safe.
 */
export const findAdsUsingCreative = async (
  db: DbConnection,
  input: { creativeId: string; organizationId: string }
): Promise<FeatureError | null> => {
  const ads = await db
    .select({ id: metaAd.id, name: metaAd.name })
    .from(metaAd)
    .where(
      and(
        eq(metaAd.organizationId, input.organizationId),
        or(
          eq(metaAd.videoId, input.creativeId),
          eq(metaAd.graphicId, input.creativeId)
        )
      )
    );

  if (ads.length === 0) return null;

  const names = ads.slice(0, NAMES_SHOWN).map((ad) => `“${ad.name}”`);
  const rest = ads.length - names.length;
  const list =
    rest > 0 ? `${names.join(', ')} and ${rest} more` : names.join(', ');

  const subject = ads.length === 1 ? 'an ad' : `${ads.length} ads`;
  return new FeatureError(
    ErrorCodes.CONFLICT,
    `This creative is used by ${subject} — ${list}. Delete the ad first, or replace its creative, then try again.`,
    { adIds: ads.map((ad) => ad.id) }
  );
};
