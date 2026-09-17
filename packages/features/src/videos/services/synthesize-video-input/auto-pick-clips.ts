import { listAssets, listAssetsByService } from '../../../assets/index.js';
import type { DbConnection } from '../../../shared/index.js';

/**
 * Pick up to `targetCount` video asset IDs from the org library.
 *
 * Service-linked assets come first (when `serviceId` is given), then any
 * remaining org-wide video assets backfill the slots. Returns an array of
 * unique asset IDs, capped at `targetCount`. Returns an empty array if the
 * org has no video assets — the caller treats that as a soft failure and
 * lets the draft persist without clips.
 */
export const autoPickClips = async (
  db: DbConnection,
  organizationId: string,
  serviceId: string | null,
  targetCount: number
): Promise<string[]> => {
  const ordered: string[] = [];
  const seen = new Set<string>();

  if (serviceId) {
    const linked = await listAssetsByService(db, {
      serviceId,
      organizationId,
    });
    if (linked.success) {
      for (const a of linked.data) {
        if (a.type !== 'video') continue;
        // The render queue deliberately rejects pending/failed transcodes
        // to protect the worker from raw 4K/HEVC inputs. Do not seed a new
        // draft with a clip that can never render yet.
        if (a.transcodeStatus !== 'ready' && a.transcodeStatus !== 'skipped') {
          continue;
        }
        if (seen.has(a.id)) continue;
        seen.add(a.id);
        ordered.push(a.id);
        if (ordered.length >= targetCount) return ordered;
      }
    }
  }

  // NO org-wide backfill when we know the service.
  //
  // This used to top up from the whole library by `createdAt desc`, which
  // meant the org's most RECENT video filled the slot no matter what it
  // showed. A clinic with one uploaded clip got that clip in every video for
  // every service — reported as "I asked for an IV drips video and it used my
  // unrelated clip", and it is the same defect as the planner's, arrived at
  // from the opposite direction: the planner refuses to borrow another
  // service's footage ("an on-screen story about service A over clips of
  // service B"), and this path borrowed footage belonging to no service at all.
  //
  // Returning FEWER clips is the correct outcome. An empty or short list is
  // filled at export by `queue-video-export`, which draws on the service's
  // rotation pool — the org's own linked media first, then curated stock
  // MATCHED to this service. For IV drips that is four genuine IV clips in the
  // bank, which beats an unrelated own clip on every axis except ownership.
  //
  // Without a serviceId there is nothing to be relevant TO, so recency is the
  // only signal available and the backfill still applies.
  if (serviceId) return ordered;

  const all = await listAssets(db, {
    organizationId,
    type: 'video',
    limit: Math.max(targetCount * 2, 20),
    offset: 0,
  });
  if (all.success) {
    for (const a of all.data.items) {
      if (a.transcodeStatus !== 'ready' && a.transcodeStatus !== 'skipped') {
        continue;
      }
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      ordered.push(a.id);
      if (ordered.length >= targetCount) return ordered;
    }
  }

  return ordered;
};
