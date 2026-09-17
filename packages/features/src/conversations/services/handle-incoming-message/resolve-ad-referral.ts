import { metaAd } from '@borradh-workspace/database';
import type { ConversationMetadata } from '@borradh-workspace/database';
import { createLogger } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';

import type { DbConnection } from '../../../shared/index.js';

const logger = createLogger('ResolveAdReferral');

export interface AdReferralInput {
  metaAdId: string;
  source?: string;
  adTitle?: string;
  /**
   * Ad creative image/video from the live `ads_context_data`. These are
   * EPHEMERAL Meta CDN URLs (scoped to the click) — used only as a fallback
   * when we can't resolve the ad to a durable local creative.
   */
  adPhotoUrl?: string;
  adVideoUrl?: string;
}

export type AdMetadataUpdate = Pick<
  ConversationMetadata,
  'adMetaId' | 'adInternalId' | 'adTitle' | 'adPhotoUrl' | 'adVideoUrl'
>;

/**
 * Durable ad creative pulled from our own DB. Prefers the locally-rendered
 * video poster/playback (our CDN) over the stored Meta thumbnail.
 */
interface LocalCreative {
  photoUrl?: string;
  videoUrl?: string;
  title?: string;
}

/**
 * Resolve a durable creative for a local `meta_ad` row. Order of preference:
 * local video poster (our CDN) → stored Meta creative thumbnail. The playable
 * video, when present, is our rendered `blobUrl` (also our CDN).
 */
async function resolveLocalCreative(
  db: DbConnection,
  adInternalId: string
): Promise<LocalCreative> {
  const ad = await db.query.metaAd.findFirst({
    where: eq(metaAd.id, adInternalId),
    columns: { metaThumbnailUrl: true, headline: true, name: true },
    with: { video: { columns: { thumbnailUrl: true, blobUrl: true } } },
  });
  if (!ad) return {};
  return {
    photoUrl: ad.video?.thumbnailUrl ?? ad.metaThumbnailUrl ?? undefined,
    videoUrl: ad.video?.blobUrl ?? undefined,
    title: ad.headline ?? ad.name ?? undefined,
  };
}

/**
 * Merge a resolved local creative onto the ad metadata, falling back to the
 * ephemeral Meta referral URLs only when the local DB has nothing.
 */
function applyCreative(
  adUpdate: AdMetadataUpdate,
  referral: AdReferralInput,
  local: LocalCreative
): void {
  const photo = local.photoUrl ?? referral.adPhotoUrl;
  const video = local.videoUrl ?? referral.adVideoUrl;
  if (photo) adUpdate.adPhotoUrl = photo;
  if (video) adUpdate.adVideoUrl = video;
  // The lead saw the ad's headline as the title; keep the referral's value but
  // backfill from the local creative when the referral didn't carry one.
  if (!adUpdate.adTitle && local.title) adUpdate.adTitle = local.title;
}

export interface ResolveAdReferralOptions {
  /**
   * Called when the referral's `metaAdId` isn't found in `meta_ad`. Returns the
   * internal ad id if it could lazily resolve/import the ad, else null. Lets
   * the caller (the webhook path) import unknown Meta-Ads-Manager ads without
   * this module depending on meta-ads/credentials. Any throw is swallowed.
   * See docs/implementations/ctm-ad-lazy-import.md.
   */
  onMissingAd?: (metaAdId: string) => Promise<string | null>;
}

/**
 * Look up ad referral metadata and resolve internal ad ID.
 * Returns null when no referral data is provided.
 */
export async function resolveAdReferral(
  db: DbConnection,
  referral: AdReferralInput | undefined,
  options?: ResolveAdReferralOptions
): Promise<AdMetadataUpdate | null> {
  if (!referral?.metaAdId) return null;

  logger.info('Resolving ad referral', {
    metaAdId: referral.metaAdId,
    source: referral.source,
    adTitle: referral.adTitle,
  });

  // Seed with the ephemeral Meta referral creative; a resolved local ad below
  // overrides these with durable (our-CDN) URLs via applyCreative.
  const adUpdate: AdMetadataUpdate = {
    adMetaId: referral.metaAdId,
    adTitle: referral.adTitle,
    ...(referral.adPhotoUrl ? { adPhotoUrl: referral.adPhotoUrl } : {}),
    ...(referral.adVideoUrl ? { adVideoUrl: referral.adVideoUrl } : {}),
  };

  try {
    const foundAd = await db.query.metaAd.findFirst({
      where: eq(metaAd.metaAdId, referral.metaAdId),
      columns: { id: true },
    });
    if (foundAd) {
      adUpdate.adInternalId = foundAd.id;
      applyCreative(
        adUpdate,
        referral,
        await resolveLocalCreative(db, foundAd.id)
      );
      logger.info('Resolved ad referral to internal ad', {
        metaAdId: referral.metaAdId,
        internalAdId: foundAd.id,
      });
    } else if (options?.onMissingAd) {
      // Not in our DB — try to lazily import it from Meta so the chatbot
      // service mapping and campaign attribution work for externally-created
      // ads. Best-effort: a null/throw leaves adInternalId unset.
      try {
        const importedId = await options.onMissingAd(referral.metaAdId);
        if (importedId) {
          adUpdate.adInternalId = importedId;
          applyCreative(
            adUpdate,
            referral,
            await resolveLocalCreative(db, importedId)
          );
          logger.info('Imported ad referral from Meta', {
            metaAdId: referral.metaAdId,
            internalAdId: importedId,
          });
        } else {
          logger.warn('Ad referral not found and could not be imported', {
            metaAdId: referral.metaAdId,
          });
        }
      } catch {
        logger.warn('Ad referral lazy import threw, continuing without it', {
          metaAdId: referral.metaAdId,
        });
      }
    } else {
      logger.warn('Ad referral not found in database', {
        metaAdId: referral.metaAdId,
      });
    }
  } catch {
    // Non-critical — continue without internal ad ID
  }

  return adUpdate;
}
