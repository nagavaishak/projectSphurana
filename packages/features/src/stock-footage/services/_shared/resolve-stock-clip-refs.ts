import {
  type StockClip,
  organization,
  organizationService,
  serviceStockClip,
  stockClip,
} from '@borradh-workspace/database';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';
import { stockVerticalForBusinessType } from '../../vertical-map.js';

/**
 * The subset of a stock clip both selectors need: enough to mint an asset
 * (video b-roll) or to hand a URL straight to the image-generation slot.
 */
/**
 * Which bucket a clip came out of.
 *
 * `service-match` — the matcher linked this clip to THIS service by technique.
 * `generic` — the ambient fallback pool, admitted on region-safety alone. It
 *   does not depict the service and frequently has nothing to do with it: the
 *   generic pool served an IV drip, a syringe and IV bags for a cryotherapy
 *   facial. Callers that can do better than an unrelated photograph should
 *   treat this as "no suitable stock" rather than as a result.
 */
export type StockMatchSource = 'service-match' | 'generic';

export type StockClipRef = Pick<
  StockClip,
  | 'id'
  | 'mediaType'
  | 'blobUrl'
  | 'transcodedBlobUrl'
  | 'durationSec'
  | 'width'
  | 'height'
  | 'contentType'
  | 'description'
  | 'isGeneric'
  | 'active'
  | 'regions'
> & { matchSource: StockMatchSource };

const REF_COLUMNS = {
  id: true,
  mediaType: true,
  blobUrl: true,
  transcodedBlobUrl: true,
  durationSec: true,
  width: true,
  height: true,
  contentType: true,
  description: true,
  isGeneric: true,
  active: true,
  regions: true,
} as const;

export interface ResolveStockClipRefsOptions {
  organizationId: string;
  serviceId?: string | null;
  count: number;
  /** Override the vertical; otherwise derived from the org's business type. */
  vertical?: string | null;
  /** Strict filter — return only this media type. */
  mediaType?: 'video' | 'image';
  /** Soft ordering — put this media type first. Ignored when `mediaType` set. */
  preferMediaType?: 'video' | 'image';
  /** stock_clip ids to skip (already consumed by an earlier clip/slot). */
  excludeStockClipIds?: string[];
  /**
   * When set, rotate the final candidate list by this key so different callers
   * (e.g. carousel slides keyed by slide prompt) get different top picks
   * instead of all landing on the same clip. Omit for b-roll, where the
   * service-match → generic order is meaningful.
   */
  rotationSeed?: string;
}

/**
 * Deterministic per-org rotation of the generic pool so two clinics drawing
 * from it don't get identical picks, while one org stays stable across renders.
 */
function rotateByKey<T>(arr: T[], key: string): T[] {
  if (arr.length <= 1) return arr;
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  const offset = h % arr.length;
  return [...arr.slice(offset), ...arr.slice(0, offset)];
}

/**
 * Shared core for both stock selectors: produce an ordered, deduped list of
 * stock clip refs for a service — the matcher's service-specific picks first
 * (ranked), then the generic/ambient pool (rotated per org) — with a media-type
 * policy applied. Used by the video b-roll selector (prefers video, then mints)
 * and the image-generation slot selector (strict image, URL only).
 */
export async function resolveStockClipRefs(
  db: DbConnection,
  opts: ResolveStockClipRefsOptions
): Promise<StockClipRef[]> {
  let vertical = opts.vertical ?? null;
  if (!vertical) {
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, opts.organizationId),
      columns: { businessType: true },
    });
    vertical = stockVerticalForBusinessType(org?.businessType);
  }
  // NOT `if (!vertical) return []`. An org whose business_type does not map to a
  // vertical used to get NOTHING — not even its own service-matched clips,
  // which are gated on technique and never on vertical. A field the design has
  // already declared unreliable should not be able to empty the whole result.
  //
  // A null vertical now only widens the ambient query below (every unscoped
  // clip qualifies), which is the same outcome the exact-match filter was
  // reaching for and never achieving.

  const exclude = new Set(opts.excludeStockClipIds ?? []);
  const seen = new Set<string>();
  const ordered: StockClipRef[] = [];

  // Service-specific matches first (ranked by the matcher).
  if (opts.serviceId) {
    const matched = await db.query.serviceStockClip.findMany({
      where: eq(serviceStockClip.organizationServiceId, opts.serviceId),
      orderBy: [asc(serviceStockClip.rank)],
      columns: { stockClipId: true },
      with: { stockClip: { columns: REF_COLUMNS } },
    });
    for (const m of matched) {
      const ref = m.stockClip as StockClipRef | null;
      if (ref?.active && !exclude.has(ref.id) && !seen.has(ref.id)) {
        ordered.push({ ...ref, matchSource: 'service-match' });
        seen.add(ref.id);
      }
    }
  }

  // Generic/ambient pool (also the fallback when there are no service matches).
  //
  // "Generic" does NOT mean region-neutral. The pool is 49 `environment` clips
  // and several carry a region: a sheet mask on a face, a brush on a back, a
  // facial handpiece. This query had no region clause at all, so an Aqualyx
  // service — abdomen, flank, thighs, chin — was handed a `full face` sheet
  // mask, which is what a customer reported.
  //
  // So a generic clip is admitted when it is genuinely neutral (no regions: an
  // empty treatment room, a shelf of bottles, staff at a computer) or when it
  // overlaps a region the service actually treats. A region-tagged clip that
  // shares nothing with the service is excluded — it is a different treatment
  // wearing an "ambient" label.
  //
  // Kept in JS rather than pushed into SQL because the service's regions are
  // already loaded below and the pool is ~50 rows; a second query and an
  // arrayOverlaps for that is not worth the round trip.
  const serviceRegions = opts.serviceId
    ? ((
        await db.query.organizationService.findFirst({
          where: eq(organizationService.id, opts.serviceId),
          columns: { regions: true },
        })
      )?.regions ?? [])
    : [];

  // `vertical` matches, OR the clip has none.
  //
  // This required an exact match, and the service's own docstring already said
  // why that cannot work: "`vertical` was derived from the org's business_type,
  // which a 2026 prod audit found unreliable ... and it is NULL on every clip
  // ingested since". The technique gate was rewritten to stop using it. The
  // ambient branch was not.
  //
  // Measured on the live bank: 230 of 281 active clips have vertical NULL, and
  // ALL 38 video clips in the ambient pool do. So a video top-up matched
  // nothing — the pool looked full and returned an empty set, which is why a
  // service with two matched clips kept showing the same injection twice.
  //
  // A clip that DOES carry a vertical still respects it; a null one is treated
  // as unscoped rather than as belonging to no vertical at all.
  const generics = await db.query.stockClip.findMany({
    where: and(
      // `eq(col, null)` is never true in SQL, so the null case is its own
      // clause rather than folded into the or().
      vertical
        ? or(eq(stockClip.vertical, vertical), isNull(stockClip.vertical))
        : isNull(stockClip.vertical),
      eq(stockClip.isGeneric, true),
      eq(stockClip.active, true)
    ),
    columns: REF_COLUMNS,
  });
  const regionSafeGenerics = (generics as StockClipRef[]).filter((g) => {
    const clipRegions = g.regions ?? [];
    // A clip with no regions is genuinely neutral — an empty room, a shelf of
    // bottles, staff at a computer. Always safe.
    if (clipRegions.length === 0) return true;
    // The clip names a body part. Admit it only if the service treats that
    // part. An empty `serviceRegions` is NOT permission: on the service side it
    // means region-neutral (matches any clip of the right technique), but here
    // it means we do not know what body part this treatment involves — and a
    // sheet mask on an Aqualyx video is exactly the mistake that makes. When in
    // doubt, take the neutral clip.
    if (serviceRegions.length === 0) return false;
    return clipRegions.some((r) => serviceRegions.includes(r));
  });
  for (const ref of rotateByKey(regionSafeGenerics, opts.organizationId)) {
    if (!exclude.has(ref.id) && !seen.has(ref.id)) {
      ordered.push({ ...ref, matchSource: 'generic' });
      seen.add(ref.id);
    }
  }

  let result = ordered;
  if (opts.mediaType) {
    result = ordered.filter((r) => r.mediaType === opts.mediaType);
  } else if (opts.preferMediaType) {
    const pref = opts.preferMediaType;
    // Array.prototype.sort is stable, so equal-key items keep match/rotation order.
    result = [...ordered].sort(
      (a, b) => (a.mediaType === pref ? 0 : 1) - (b.mediaType === pref ? 0 : 1)
    );
  }

  if (opts.rotationSeed && result.length > 1) {
    result = rotateByKey(result, opts.rotationSeed);
  }

  return result.slice(0, opts.count);
}
