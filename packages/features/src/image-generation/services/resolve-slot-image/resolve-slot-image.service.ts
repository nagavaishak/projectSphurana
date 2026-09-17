/**
 * `resolveSlotImage` — turn a planner image-fill source into a concrete URL.
 *
 * Priority chain (per `daniel`'s product call 2026-05-27):
 *   1. Service video → use the asset's `thumbnailUrl` (pre-generated screenshot)
 *   2. Service uploaded photo → use the asset's `blobUrl`
 *   2.5 Curated stock still
 *   3. AI generation via Imagen 3 → upload the bytes to org-assets, return URL
 *
 * WHICH tiers are eligible is decided by a single `ImageryPolicy`, not by a
 * handful of booleans — see `../../imagery-policy.ts`. The AI tier is no longer
 * unreachable behind stock: under `own-then-stock-then-ai`, stock only answers
 * when the matcher genuinely linked the clip to this service, and the ambient
 * fallback pool falls through to AI instead. Handing the model an unrelated
 * stock photograph alongside permission to invent one is how a cryotherapy deck
 * ended up illustrated with an IV drip.
 *
 * Selection rules within a tier:
 *   - Pick the most recently uploaded asset (highest `capturedAt`, falling
 *     back to `createdAt`). Deterministic and avoids re-using the same photo
 *     across all 4 slots in a 2×2 collage template.
 *   - When multiple slots resolve on the same template, the caller passes
 *     `usedAssetIds` so we can skip ones already consumed by an earlier
 *     slot. This prevents the same photo appearing in 4 quadrants of a
 *     "look at these 4 example photos" template.
 *
 * Returns the resolved URL + the source tier that produced it (for logs +
 * future analytics on how often each tier fires).
 */

import {
  asset,
  assetService,
  organizationService,
} from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
import {
  getOrgAssetsBucket,
  getPresignedDownloadUrl,
  getSignedCdnUrl,
  isCdnEnabled,
  upload,
} from '@borradh-workspace/storage';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { claimRotatedAsset, markAssetUsed } from '../../../assets/index.js';
import {
  type DbConnection,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { selectStockImage } from '../../../stock-footage/index.js';
import {
  type ImageryPolicy,
  type ImagerySource,
  imageryPolicyFromLegacyFlags,
  policyAcceptsGenericStock,
  policyAllowsAi,
  policyAllowsOwnAssets,
  policyAllowsStock,
} from '../../imagery-policy.js';
import { resolveReferenceImageUrl } from '../../resolve-reference-image-urls.js';
import { generateAiImage } from '../generate-ai-image/index.js';
import { verifyAssetDepictsService } from '../verify-asset-depicts-service/index.js';

/**
 * Alpha of the black scrim composited onto AI-generated fills (0..1).
 * AI background images come back brightly + evenly lit, which kills the
 * contrast of the white/light template text rendered on top. A uniform
 * dark overlay darkens the image so overlaid copy stays legible. Tune here
 * if backgrounds read too dark or too washed-out.
 */
const logger = createLogger('ResolveSlotImage');

const AI_FILL_SCRIM_ALPHA = 0.4;

/**
 * Bake a uniform dark scrim onto an AI-generated PNG to restore text
 * contrast. Equivalent to laying a black layer at `AI_FILL_SCRIM_ALPHA`
 * over the image (out = in * (1 - alpha)). Falls back to the original
 * bytes if the composite fails — a slightly-light image beats no image.
 */
async function applyContrastScrim(png: Buffer): Promise<Buffer> {
  try {
    const base = sharp(png);
    const meta = await base.metadata();
    if (!meta.width || !meta.height) return png;
    return await base
      .composite([
        {
          input: {
            create: {
              width: meta.width,
              height: meta.height,
              channels: 4,
              background: { r: 0, g: 0, b: 0, alpha: AI_FILL_SCRIM_ALPHA },
            },
          },
          blend: 'over',
        },
      ])
      .png()
      .toBuffer();
  } catch {
    return png;
  }
}

export type ResolveSlotImageSource =
  | 'service-video-thumbnail'
  | 'service-image-asset'
  | 'stock-image'
  | 'ai-generated'
  | 'no-resolution';

export interface ResolveSlotImageInput {
  organizationId: string;
  /** The service the planner picked for this graphic — used to filter assets. */
  targetServiceId?: string;
  /** Generation prompt from the planner — used iff we fall through to AI. */
  prompt: string;
  /** Slot bbox — used to pick Imagen's aspect ratio. */
  bbox: { w: number; h: number };
  /**
   * Asset ids that earlier slots on the same template already consumed.
   * Excludes them from the service-asset query so a multi-photo template
   * doesn't repeat the same image in every quadrant.
   */
  usedAssetIds?: string[];
  /**
   * Owner-selected uploaded image ids. When supplied, selection is strict:
   * only these org-owned raw image assets are considered, in this order.
   */
  sourceAssetIds?: string[];
  /**
   * Whether tier-3 AI image generation is permitted for this graphic.
   * Defaults to `false`: graphics use the service's uploaded screenshots /
   * photos (tier 1/2) only, and fall back to the template's default image
   * (`no-resolution`) when none exist. AI is opt-in — the monthly batch
   * never sets it, and the manual generate-graphic flow only sets it when
   * the user explicitly toggles "Use AI-generated images".
   */
  allowAiImages?: boolean;
  /**
   * Varies the stock pick between slots of the SAME deck.
   *
   * The stock tier rotates on `rotationSeed`, and the comment beside it says
   * "so a carousel's slides don't all repeat one still" — but every slide of a
   * deck passes the same `prompt` as the seed, so the seed was identical and so
   * was the clip. One 8-slide deck came back with the same stock still on every
   * slide that reached this tier.
   */
  rotationSalt?: string;
  /**
   * Skip the org's own assets and go straight to stock.
   *
   * Set for the slides of a deck BEYOND the size of the service's own asset
   * pool. A service with two photos and eight slides used to rotate those two
   * round and round; those slides now take a stock still each instead, which
   * is more varied than the same photo four times.
   */
  preferStock?: boolean;
  /**
   * Whether the curated stock-image tier (tier 2.5) may fill a slot when the
   * org has no service photo of its own. Defaults to `true` (treat any value
   * other than an explicit `false` as enabled) so existing callers keep their
   * current behaviour. The manual generate-graphic flow sets it to `false`
   * when the user turns off "Use curated stock photos".
   */
  allowStockImages?: boolean;
  /**
   * The ground the brand's own posts sit on (`light-ground`, `dark-ground`, …).
   * Passed down to the AI-fill prompt so an invented photograph arrives
   * compatible with the deck rather than bringing its own colour cast.
   */
  referenceColourway?: string;
  /**
   * The named imagery policy. When supplied it REPLACES `allowAiImages` /
   * `allowStockImages` entirely — those remain only so existing callers keep
   * working, and are folded into a policy via `imageryPolicyFromLegacyFlags`.
   */
  policy?: ImageryPolicy;
}

export interface ResolveSlotImageOutput {
  url: string;
  source: ResolveSlotImageSource;
  /** Set when `source` matches a tier that consumed a service asset. */
  consumedAssetId?: string;
  /** Set when `source === 'stock-image'` — the curated clip the still came from. */
  consumedStockClipId?: string;
  /**
   * Every asset that was eligible for this slot, in the order they were
   * ranked. Recorded as provenance so "why did it pick that photo?" is
   * answerable — and so a service with one candidate is visibly
   * distinguishable from one with twenty.
   */
  candidateAssetIds?: string[];
  /**
   * Eligible assets after the quality floor. 1 means repetition is
   * unavoidable for this service and no rotation can help — that is a
   * content-mix problem, not a selection one.
   */
  rotationPoolSize?: number;
  /** Assets excluded by the quality floor (blurry / shaky / equipment-only). */
  excludedForQuality?: number;
  /**
   * The same decision as `source`, but as a tagged union that keeps its
   * provenance. Callers should switch on `imagery.kind` rather than flattening
   * this to a boolean — a stock still and the client's own photograph are
   * different claims about the world, and a prompt that calls them the same
   * thing pins an irrelevant stock image into the graphic as fact.
   */
  imagery: ImagerySource;
}

interface ServiceAssetRow {
  id: string;
  type: 'video' | 'image';
  blobUrl: string;
  thumbnailUrl: string | null;
  capturedAt: Date | null;
  createdAt: Date;
}

/**
 * A row can only fill an image slot if a bitmap can actually be got out of it:
 * an image has its `blobUrl`, a video has nothing but its generated thumbnail.
 *
 * The same predicate `claimRotatedAsset` applies under `requireThumbnail`. It
 * lives here too because the two used to disagree, and the disagreement shipped:
 * ONE `resolveSlotImage` call returned `rotationPoolSize: 2` from the claim and
 * a seven-long `candidateAssetIds` from this scan, five of them thumbnail-less
 * videos. `selectServiceAsset` then applied the real test at PICK time, so the
 * scan was free to advertise rows nothing could ever choose.
 *
 * That gap had a consumer. `orchestrateCarousel` builds a deck's photo pool from
 * `candidateAssetIds` and hands slide *i* the *i*th id as an explicit
 * `sourceAssetIds`, so the five unusable rows became five slides that were
 * promised a photograph, resolved nothing, and fell through to
 * `model-invented` — one of which drew a fabricated own-brand product bottle.
 *
 * Emitting only what can be chosen makes the scan's count mean what its name
 * says, and leaves `selectServiceAsset` doing tier ORDERING rather than
 * silently doubling as a filter.
 */
const usableAsStill = () =>
  sql`(${asset.type} = 'image' OR (${asset.type} = 'video' AND ${asset.thumbnailUrl} IS NOT NULL))`;

/**
 * Pull every video / image asset linked to the target service, scoped to
 * the org. Ordered most-recent-first.
 */
async function fetchServiceAssets(
  db: DbConnection,
  organizationId: string,
  serviceId: string,
  excludeIds: string[]
): Promise<ServiceAssetRow[]> {
  const conditions = [
    eq(asset.organizationId, organizationId),
    eq(assetService.serviceId, serviceId),
    inArray(asset.type, ['video', 'image'] as const),
    usableAsStill(),
    notDeleted(asset),
  ];
  if (excludeIds.length > 0) {
    conditions.push(
      sql`${asset.id} NOT IN (${sql.join(
        excludeIds.map((id) => sql`${id}`),
        sql`, `
      )})`
    );
  }

  const rows = await db
    .select({
      id: asset.id,
      type: asset.type,
      blobUrl: asset.blobUrl,
      thumbnailUrl: asset.thumbnailUrl,
      capturedAt: asset.capturedAt,
      createdAt: asset.createdAt,
    })
    .from(asset)
    .innerJoin(assetService, eq(assetService.assetId, asset.id))
    .where(and(...conditions))
    .orderBy(desc(asset.capturedAt), desc(asset.createdAt));

  return rows as ServiceAssetRow[];
}

/**
 * Resolve the assets a caller named explicitly.
 *
 * Accepts VIDEO as well as image. It used to demand `type = 'image'`, which
 * meant a named video was not "unusable" but invisible: the row simply did not
 * come back, `selectServiceAsset` saw an empty list, and the slot fell through
 * to invented imagery with no decision recorded. A video that carries a
 * generated thumbnail is a perfectly good still — tier 1 of the priority chain
 * is literally "service video → use its thumbnail" — so rejecting it here
 * contradicted the tier immediately below.
 *
 * Both paths now admit the same rows, which is the invariant that was missing:
 * anything the scan can offer, the explicit path can take.
 *
 * Still scoped to `source = 'raw'` — an explicit selection means the owner's own
 * upload, and letting a stock row answer here would relabel library footage as
 * the business's own work in the prompt. A stock row that carries a thumbnail
 * can therefore still be offered by the scan and refused here; that residual is
 * narrower than what it replaces and is noted rather than widened blind.
 */
async function fetchChosenAssets(
  db: DbConnection,
  organizationId: string,
  sourceAssetIds: string[],
  excludeIds: string[]
): Promise<ServiceAssetRow[]> {
  const excluded = new Set(excludeIds);
  const eligibleIds = sourceAssetIds.filter((id) => !excluded.has(id));
  if (eligibleIds.length === 0) return [];

  const rows = await db
    .select({
      id: asset.id,
      type: asset.type,
      blobUrl: asset.blobUrl,
      thumbnailUrl: asset.thumbnailUrl,
      capturedAt: asset.capturedAt,
      createdAt: asset.createdAt,
    })
    .from(asset)
    .where(
      and(
        eq(asset.organizationId, organizationId),
        usableAsStill(),
        eq(asset.source, 'raw'),
        inArray(asset.id, eligibleIds),
        notDeleted(asset)
      )
    );

  const rowById = new Map(rows.map((row) => [row.id, row]));
  return eligibleIds
    .map((id) => rowById.get(id))
    .filter((row): row is ServiceAssetRow => Boolean(row));
}

/**
 * Tier 1 + 2 of the priority chain: pick the best service asset.
 * Returns `null` when nothing matches (caller falls through to AI).
 *
 * Tier 1 still beats tier 2 — a real video frame of the treatment is better
 * evidence than a stray photo — but WITHIN each tier the caller has already
 * rotated `rows` so we don't hand back the same asset every time.
 */
function selectServiceAsset(rows: ServiceAssetRow[]): {
  url: string;
  source: 'service-video-thumbnail' | 'service-image-asset';
  id: string;
} | null {
  // Tier 1: video with a usable thumbnail.
  for (const row of rows) {
    if (row.type === 'video' && row.thumbnailUrl) {
      return {
        url: row.thumbnailUrl,
        source: 'service-video-thumbnail',
        id: row.id,
      };
    }
  }
  // Tier 2: any image asset.
  for (const row of rows) {
    if (row.type === 'image') {
      return {
        url: row.blobUrl,
        source: 'service-image-asset',
        id: row.id,
      };
    }
  }
  return null;
}

/**
 * Direct the invented photograph AWAY from inventing a person.
 *
 * The topic went to the image model raw — "Preparing for your first Embody Tone
 * session" — and the model's default answer to any wellness topic is a smiling
 * woman. One five-slide deck came back with invented people on three slides,
 * each presented as this business's client or staff. They are permitted (the
 * batch opts into AI imagery) and the gate correctly logs them as warnings, but
 * a feed of strangers is not what an owner wants, and a room, a texture or a
 * pair of hands carries the same slide without asserting anyone exists.
 *
 * This wraps the prompt at the point the photograph is actually GENERATED. An
 * earlier attempt put the same instruction in the composer's prompt, on the
 * `model-invented` branch — but this path returns `ai-fill`, so the composer
 * never saw it and the instruction reached nothing.
 */
function directInventedImagery(topic: string, colourway?: string): string {
  // Name the deck's GROUND to the image generator, not just to the composer.
  //
  // The composer is told to match the cover's background; the photograph is
  // generated by a different call that knows nothing about the brand. It
  // returned warm cream and peach rooms for a brand that works on pink, and a
  // large image with a strong ground outvoted the anchor. Asking for a
  // compatible photograph is cheaper than asking the composer to fight one.
  const ground =
    colourway === 'dark-ground'
      ? 'Dark, low-key scene — deep shadow, minimal bright area.'
      : colourway === 'brand-colour-ground'
        ? 'Neutral, unsaturated scene that will sit on a strong flat colour without clashing.'
        : 'Bright, airy, high-key scene on pale neutral tones — soft whites, greys and stone. Avoid a strongly coloured cast of any kind (no warm amber, cream, peach or gold wash).';
  return [
    `Editorial photograph for a wellness/aesthetics business. Subject: ${topic}.`,
    ground,
    'Show the PLACE or the DETAIL, not a person: the treatment room, the equipment, materials, fabric, hands at work, a still life, the light in the space.',
    'Do NOT include a face. Do NOT include a full figure. If a person is unavoidable, show only hands or a cropped detail, never a portrait and never anyone recognisable.',
    'Natural light, shallow depth of field, calm and unstyled. No text, no logos, no graphics, no watermarks, no collage or before/after pairing.',
  ].join(' ');
}

/**
 * Tier 3: AI-generate, upload, return a signed URL the renderer can fetch.
 */
async function aiGenerateAndUpload(
  organizationId: string,
  prompt: string,
  bbox: { w: number; h: number },
  colourway?: string
): Promise<Result<{ url: string }>> {
  const genResult = await generateAiImage({
    prompt: directInventedImagery(prompt, colourway),
    bbox,
  });
  if (!genResult.success) {
    return err(genResult.error) as Result<{ url: string }>;
  }
  // Darken the bright AI output so the template's overlaid text stays legible.
  const png = await applyContrastScrim(genResult.data.png);
  const bucket = getOrgAssetsBucket();
  // Use a content-hash-prefixed key so identical prompt+bbox pairs collide
  // — Imagen's output isn't deterministic but the de-dupe is harmless and
  // saves storage on accidental re-runs.
  const key = `${organizationId}/image-generation/ai-fills/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.png`;
  await upload({
    bucket,
    key,
    body: png,
    contentType: 'image/png',
  });
  const url = isCdnEnabled()
    ? getSignedCdnUrl(key)
    : await getPresignedDownloadUrl({ bucket, key });
  return ok({ url });
}

/**
 * Does this asset actually show this service? Cached on the link.
 *
 * The tagging classifier's `confidence` cannot catch its own mistakes — it
 * scored a coffee-scrub clip 0.8 for "Deep Steam Facial", its highest of three
 * services, and the graphic that used it described an "aromatic coffee scrub"
 * as part of the facial. So the pixels get a second opinion, ONCE per link.
 *
 * Returns true unless we positively know otherwise. A cached `false` is the
 * only reason to reject: unchecked, unfetchable and errored all mean "no
 * opinion", because a wrong photograph is a false claim about the business but
 * a check that could not run is not evidence against the image.
 */
async function assetDepictsService(
  db: DbConnection,
  args: { assetId: string; serviceId: string; imageUrl: string }
): Promise<boolean> {
  try {
    return await assetDepictsServiceImpl(db, args);
  } catch (error) {
    // FAIL OPEN on anything unexpected — including the columns not existing.
    // `depicts_service` arrives in migration 0124, and this code runs against
    // databases that predate it; a check that cannot run is not evidence
    // against the photograph, and must never cost the business its own image.
    logger.warn('Asset depiction check could not run — keeping the asset', {
      assetId: args.assetId,
      serviceId: args.serviceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

async function assetDepictsServiceImpl(
  db: DbConnection,
  args: { assetId: string; serviceId: string; imageUrl: string }
): Promise<boolean> {
  const [link] = await db
    .select({ depicts: assetService.depictsService })
    .from(assetService)
    .where(
      and(
        eq(assetService.assetId, args.assetId),
        eq(assetService.serviceId, args.serviceId)
      )
    )
    .limit(1);

  if (link?.depicts === false) return false;
  if (link?.depicts === true) return true;

  const depicts = await imageDepictsService(db, {
    serviceId: args.serviceId,
    imageUrl: args.imageUrl,
  });
  if (depicts === null) return true;

  // Cache both answers — a confirmed match must not be re-verified either.
  await db
    .update(assetService)
    .set({ depictsService: depicts, depictsCheckedAt: new Date() })
    .where(
      and(
        eq(assetService.assetId, args.assetId),
        eq(assetService.serviceId, args.serviceId)
      )
    );

  return depicts;
}

/**
 * Ask the model whether an image depicts the service.
 *
 * `null` is NO OPINION — unknown service, unfetchable image, or a check that
 * did not complete — and every caller must read that as "keep the image".
 * A check that could not run is not evidence against a photograph.
 *
 * Shared by the own-asset and stock paths so the question is asked one way.
 * They differ only in what they do with the answer: an asset caches it on
 * `assetService`, stock has nowhere to cache it yet.
 */
async function imageDepictsService(
  db: DbConnection,
  args: { serviceId: string; imageUrl: string }
): Promise<boolean | null> {
  const [svc] = await db
    .select({
      name: organizationService.name,
      description: organizationService.description,
    })
    .from(organizationService)
    .where(eq(organizationService.id, args.serviceId))
    .limit(1);
  if (!svc) return null;

  let bytes: Buffer;
  try {
    const url = await resolveReferenceImageUrl(args.imageUrl);
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    bytes = Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }

  const verdict = await verifyAssetDepictsService({
    image: bytes,
    serviceName: svc.name,
    serviceDescription: svc.description ?? undefined,
  });
  return verdict.success ? verdict.data.depicts : null;
}

/**
 * The same question, asked of a STOCK clip — and it has to be asked.
 *
 * ENG-720: a laser-aftercare graphic for an aesthetics clinic was illustrated
 * with a gloved hand holding a SYRINGE. The clip came back from stock as a
 * `service-match`, and nothing downstream questioned it, because verification
 * ran only on the org's own uploads.
 *
 * The reasoning written on the own-asset check — "a wrong image becomes a wrong
 * claim, because the copy describes what it can see" — is not weaker for a
 * stock photograph. "Keep skin cool and moisturized" printed beside a needle is
 * a false statement about the service either way, and the reader cannot tell
 * whose photograph it is.
 *
 * NOT CACHED, unlike the asset path: stock clips have no per-service link row
 * to hold a verdict. That costs one vision call per stock-filled slide and is
 * the reason to add a cache next, not a reason to skip the check.
 *
 * Fails OPEN, like its sibling.
 */
async function stockDepictsService(
  db: DbConnection,
  args: { serviceId: string; imageUrl: string; stockClipId: string }
): Promise<boolean> {
  try {
    const depicts = await imageDepictsService(db, {
      serviceId: args.serviceId,
      imageUrl: args.imageUrl,
    });
    return depicts !== false;
  } catch (error) {
    logger.warn('Stock depiction check could not run — keeping the clip', {
      stockClipId: args.stockClipId,
      serviceId: args.serviceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

async function resolveSlotImageImpl(
  db: DbConnection,
  input: ResolveSlotImageInput
): Promise<Result<ResolveSlotImageOutput>> {
  // ONE named policy governs the whole chain. Legacy boolean callers are
  // folded into it at the edge; nothing below this line reads the booleans.
  const policy: ImageryPolicy =
    input.policy ??
    imageryPolicyFromLegacyFlags({
      allowAiImages: input.allowAiImages,
      allowStockImages: input.allowStockImages,
    });

  // Tier 1 + 2: an explicit owner selection is strict and takes precedence;
  // otherwise retain the existing automatic service-media lookup.
  //
  // `preferStock` skips both — the caller has already decided this slot should
  // take a stock still because the service's own pool is smaller than the
  // number of slots to fill. An owner's explicit `sourceAssetIds` still wins:
  // that is an instruction, not a heuristic.
  if (
    policyAllowsOwnAssets(policy) &&
    ((input.sourceAssetIds?.length ||
      (input.targetServiceId && !input.preferStock)) ??
      false)
  ) {
    const ownerSelected = Boolean(input.sourceAssetIds?.length);
    const rows = ownerSelected
      ? await fetchChosenAssets(
          db,
          input.organizationId,
          input.sourceAssetIds as string[],
          input.usedAssetIds ?? []
        )
      : await fetchServiceAssets(
          db,
          input.organizationId,
          input.targetServiceId as string,
          input.usedAssetIds ?? []
        );

    // Rotate, so a service with two eligible photos stops producing sixteen
    // graphics of the same one. Skipped when the owner picked the assets
    // explicitly and in what order — that's an instruction, not a default.
    //
    // `claimRotatedAsset` claims AND stamps the least-recently-used asset in a
    // single statement. Reading a usage history and writing it back after the
    // render would leave a race the width of the whole generation: the worker
    // runs jobs concurrently, so two graphics for the same service would read
    // the same history and pick the same photo — precisely the batch case that
    // matters. It also applies the quality floor, so a shaky or blurry clip
    // never takes a turn in the rotation.
    let claimedAssetId: string | null = null;
    let rotationPoolSize = 0;
    let excludedForQuality = 0;
    if (!ownerSelected && input.targetServiceId) {
      const claim = await claimRotatedAsset(db, {
        organizationId: input.organizationId,
        serviceId: input.targetServiceId,
        excludeAssetIds: input.usedAssetIds ?? [],
        requireThumbnail: true,
      });
      if (claim.success) {
        claimedAssetId = claim.data.assetId;
        rotationPoolSize = claim.data.poolSize;
        excludedForQuality = claim.data.excludedForQuality;
      }
      // A failed claim is not fatal — fall through to the unrotated ordering
      // below rather than failing to produce content.
    }

    // Honour the claim by promoting it to the front; keep the rest in their
    // existing order so tier-1 (a real video frame) still beats tier-2.
    const candidates = claimedAssetId
      ? [
          ...rows.filter((r) => r.id === claimedAssetId),
          ...rows.filter((r) => r.id !== claimedAssetId),
        ]
      : rows;

    const pick = selectServiceAsset(candidates);
    // VERIFY BEFORE USING. A mis-linked photograph is worse than a generic
    // one: it is presented as the business's own work and the copy describes
    // what it can see, so a wrong image becomes a wrong claim. Only an
    // explicit `false` rejects; everything else keeps the asset.
    //
    // NOT WHEN THE OWNER NAMED IT. The check exists to police the AUTOMATIC
    // link — a photo the matcher attached to a service on its own guess. An
    // explicit `sourceAssetIds` is not a guess to be audited, it is the owner
    // standing in front of their own photograph saying "use this one", and a
    // model second-guessing that is simply wrong: they know what their work
    // looks like and the classifier does not.
    //
    // It vetoed them silently. The owner picked a facial-roller photo for a
    // facial, `assetDepictsService` returned false, the slot fell through to
    // no-photo, and the graphic came back with no picture in it and nothing
    // in the UI to say why — "I literally selected the image". The same
    // principle already governs rotation twenty lines up: an explicit
    // selection is an instruction, not a default.
    const verified =
      pick && input.targetServiceId && !ownerSelected
        ? await assetDepictsService(db, {
            assetId: pick.id,
            serviceId: input.targetServiceId,
            imageUrl: pick.url,
          })
        : true;
    if (pick && !verified) {
      logger.info('Asset rejected — does not depict the service', {
        organizationId: input.organizationId,
        serviceId: input.targetServiceId,
        assetId: pick.id,
      });
    }
    if (pick && ownerSelected && input.targetServiceId) {
      logger.info('Depiction check skipped — asset chosen by the owner', {
        organizationId: input.organizationId,
        serviceId: input.targetServiceId,
        assetId: pick.id,
      });
    }
    if (pick && verified) {
      // `thumbnailUrl` / `blobUrl` are stored as UNSIGNED private-CDN URLs
      // (or `s3://` in local dev). The headless renderer fetches slot-fill
      // URLs unauthenticated, so an unsigned private-CDN value returns 403.
      // Re-sign/presign here — same resolution the admin preview surfaces use
      // — so the asset is actually fetchable. (Tier 3 AI fills already sign.)
      // Every generation must leave a trace, not just the ones rotation chose.
      // An owner-selected asset (create-post dialog) and a claim-failure
      // fallback both land here unstamped, and unstamped reads as never-used —
      // so the next batch would reach for the photo just published manually.
      if (input.targetServiceId && pick.id !== claimedAssetId) {
        await markAssetUsed(db, {
          serviceId: input.targetServiceId,
          assetId: pick.id,
        });
      }

      const url = await resolveReferenceImageUrl(pick.url);
      const candidateAssetIds = candidates.map((c) => c.id);
      return ok({
        url,
        source: pick.source,
        consumedAssetId: pick.id,
        candidateAssetIds,
        rotationPoolSize,
        excludedForQuality,
        imagery: {
          kind: 'org-asset',
          url,
          assetId: pick.id,
          isVideoFrame: pick.source === 'service-video-thumbnail',
          candidateAssetIds,
          rotationPoolSize,
          excludedForQuality,
        },
      });
    }
  }

  // Tier 2.5: curated stock still. When the org has no service photo of its
  // own, use a stock image matched to the service instead of falling through
  // to the template's default — this is what lets graphics look relevant
  // without the client ever uploading. Rotated by the prompt so a carousel's
  // slides don't all repeat one still. URL-only (no asset minted); sign it the
  // same way a service photo is signed. before/after templates are unaffected:
  // they require real results and don't route through stock.
  //
  // Opt-out gate: the manual generate-graphic dialog lets the user turn off
  // "Use curated stock photos". Default (undefined / true) keeps stock on, so
  // every existing caller is unaffected; only an explicit `false` skips it.
  if (input.targetServiceId && policyAllowsStock(policy)) {
    const stock = await selectStockImage(db, {
      organizationId: input.organizationId,
      serviceId: input.targetServiceId,
      // The salt is what makes two slides of one deck differ. Without it every
      // slide seeds on the deck topic and gets the same still.
      rotationSeed: input.rotationSalt
        ? `${input.prompt}#${input.rotationSalt}`
        : input.prompt,
    });
    // A clip from the ambient pool is not a match — it is whatever was
    // region-safe. Under a policy with an AI backstop that counts as "no
    // suitable stock" and we fall through rather than pin an unrelated
    // photograph into the graphic.
    const usable =
      stock.success &&
      stock.data &&
      (stock.data.matchSource === 'service-match' ||
        policyAcceptsGenericStock(policy));

    if (usable && stock.success && stock.data) {
      const url = await resolveReferenceImageUrl(stock.data.url);
      // VERIFY BEFORE USING, exactly as the own-asset path does. A clip that
      // stock called a `service-match` is a claim, not a fact — ENG-720 was a
      // syringe returned for a laser session.
      const depicts = input.targetServiceId
        ? await stockDepictsService(db, {
            serviceId: input.targetServiceId,
            imageUrl: url,
            stockClipId: stock.data.stockClipId,
          })
        : true;
      if (depicts) {
        return ok({
          url,
          source: 'stock-image',
          consumedStockClipId: stock.data.stockClipId,
          imagery: {
            kind: 'stock',
            url,
            stockClipId: stock.data.stockClipId,
            matchSource: stock.data.matchSource,
          },
        });
      }
      // FALL THROUGH, do not return. The next tier is AI generation, so a
      // rejected clip becomes an invented image where policy allows one and a
      // no-resolution (the template's own default) where it does not. Either
      // beats a photograph that contradicts the copy.
      logger.info('Stock clip rejected — does not depict the service', {
        organizationId: input.organizationId,
        serviceId: input.targetServiceId,
        stockClipId: stock.data.stockClipId,
        matchSource: stock.data.matchSource,
      });
    }
  }

  // Tier 3: AI generation — opt-in only. By default graphics must use the
  // service's uploaded media; when no service asset matched we return a
  // no-resolution outcome so the renderer keeps the template's default
  // image rather than inventing an AI picture. The batch never opts in;
  // the manual flow opts in only when the user toggles "Use AI images".
  if (!policyAllowsAi(policy)) {
    return ok({
      url: '',
      source: 'no-resolution',
      imagery: { kind: 'none' },
    });
  }

  // Skipped if the env key isn't configured. The policy still PERMITS invented
  // imagery, so this reports `model-invented` rather than `none`: the caller
  // that renders the whole graphic with one model (every production path today)
  // can author its own imagery and does not need a separately generated fill.
  if (!apiEnv.GOOGLE_GENAI_API_KEY) {
    return ok({
      url: '',
      source: 'no-resolution',
      imagery: { kind: 'model-invented' },
    });
  }

  const gen = await aiGenerateAndUpload(
    input.organizationId,
    input.prompt,
    input.bbox,
    input.referenceColourway
  );
  if (!gen.success) {
    return err(gen.error) as Result<ResolveSlotImageOutput>;
  }
  return ok({
    url: gen.data.url,
    source: 'ai-generated',
    imagery: { kind: 'ai-fill', url: gen.data.url },
  });
}

export const resolveSlotImage = (
  db: DbConnection,
  input: ResolveSlotImageInput
) =>
  trackedResult(
    'imageGeneration.resolveSlotImage',
    () => resolveSlotImageImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        targetServiceId: input.targetServiceId,
        promptLength: input.prompt.length,
        usedAssetCount: input.usedAssetIds?.length ?? 0,
        policy:
          input.policy ??
          imageryPolicyFromLegacyFlags({
            allowAiImages: input.allowAiImages,
            allowStockImages: input.allowStockImages,
          }),
      },
    }
  );
