import {
  asset,
  assetService,
  organizationService,
  user,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  and,
  arrayContains,
  arrayOverlaps,
  count,
  desc,
  eq,
  ilike,
  inArray,
  ne,
  or,
} from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type ListAssetsInput,
  listAssetsInputSchema,
} from './list-assets.schema.js';

/**
 * Internal implementation of list assets
 */
const listAssetsImpl = async (db: DbConnection, input: ListAssetsInput) => {
  // Validate input
  const parsed = listAssetsInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const conditions = [
    eq(asset.organizationId, parsed.data.organizationId),
    notDeleted(asset),
    ne(asset.source, 'stock'),
  ];

  if (parsed.data.type) {
    conditions.push(eq(asset.type, parsed.data.type));
  }

  if (parsed.data.source) {
    conditions.push(eq(asset.source, parsed.data.source));
  }

  // Filter by tags - assets that have ANY of the specified tags
  if (parsed.data.tags && parsed.data.tags.length > 0) {
    conditions.push(arrayOverlaps(asset.tags, parsed.data.tags));
  }

  // Filter by placeholder type - assets that can be used for this placeholder
  if (parsed.data.placeholderType) {
    conditions.push(
      arrayContains(asset.placeholderTypes, [parsed.data.placeholderType])
    );
  }

  // Free-text search over display name OR original filename (case-insensitive
  // substring). `%` and `_` are LIKE wildcards; escape them so a literal
  // search term can't turn into a wildcard match.
  if (parsed.data.search) {
    const escaped = parsed.data.search.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const pattern = `%${escaped}%`;
    const searchCondition = or(
      ilike(asset.name, pattern),
      ilike(asset.sourceFileName, pattern)
    );
    if (searchCondition) conditions.push(searchCondition);
  }

  const { limit, offset } = parsed.data;

  const items = await withOrgScope(
    (tx) =>
      tx
        .select({
          id: asset.id,
          name: asset.name,
          blobUrl: asset.blobUrl,
          thumbnailUrl: asset.thumbnailUrl,
          sourceFileName: asset.sourceFileName,
          tags: asset.tags,
          clientName: asset.clientName,
          type: asset.type,
          source: asset.source,
          placeholderTypes: asset.placeholderTypes,
          duration: asset.duration,
          width: asset.width,
          height: asset.height,
          // Consumers that choose b-roll must be able to avoid footage which
          // is still being normalised for the render worker. Omitting this
          // field made it impossible for callers to distinguish a usable
          // video from one that will be rejected by queueVideoExport.
          transcodeStatus: asset.transcodeStatus,
          transcript: asset.transcript,
          organizationId: asset.organizationId,
          uploadedById: asset.uploadedById,
          createdAt: asset.createdAt,
          updatedAt: asset.updatedAt,
          uploader: {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
          },
        })
        .from(asset)
        .leftJoin(user, eq(asset.uploadedById, user.id))
        .where(and(...conditions))
        .orderBy(desc(asset.createdAt))
        .limit(limit)
        .offset(offset),
    { db }
  );

  // Attach the linked services per asset in ONE grouped query (not N) so the
  // gallery can badge each tile with its assigned service. Keyed off the
  // `asset_service` junction → `organization_service` for the page's ids.
  const assetIds = items.map((a) => a.id);
  const serviceLinks = assetIds.length
    ? await withOrgScope(
        (tx) =>
          tx
            .select({
              assetId: assetService.assetId,
              id: organizationService.id,
              name: organizationService.name,
            })
            .from(assetService)
            .innerJoin(
              organizationService,
              eq(assetService.serviceId, organizationService.id)
            )
            .where(inArray(assetService.assetId, assetIds)),
        { db }
      )
    : [];

  const servicesByAsset = new Map<string, { id: string; name: string }[]>();
  // The join always yields an array in production; guard keeps us safe if a
  // caller / mock returns something else.
  for (const link of Array.isArray(serviceLinks) ? serviceLinks : []) {
    const list = servicesByAsset.get(link.assetId) ?? [];
    list.push({ id: link.id, name: link.name });
    servicesByAsset.set(link.assetId, list);
  }

  const itemsWithServices = items.map((a) => ({
    ...a,
    services: servicesByAsset.get(a.id) ?? [],
  }));

  // `total` used to be the mapped PAGE length under a field named total, so it
  // could never exceed `limit` and the gallery could not page. `conditions` is
  // reused verbatim so the count cannot drift from the filters the page was
  // built with. Runs inside withOrgScope for the same RLS reasons as the page
  // query; the leftJoin is dropped because `uploadedById` is a single FK and
  // cannot change cardinality.
  const [totalRow] = await withOrgScope(
    (tx) =>
      tx
        .select({ value: count() })
        .from(asset)
        .where(and(...conditions)),
    { db }
  );

  return ok({
    items: itemsWithServices,
    total: totalRow?.value ?? 0,
    limit,
    offset,
  });
};

/**
 * List assets for an organization with optional type and tag filtering
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - List assets input with pagination and filters
 * @returns Result with array of assets or error
 */
export const listAssets = (db: DbConnection, input: ListAssetsInput) =>
  trackedResult('assets.listAssets', () => listAssetsImpl(db, input), {
    properties: { organizationId: input.organizationId },
  });

/**
 * Result type for listAssets
 */
export type ListAssetsResult = Awaited<ReturnType<typeof listAssets>>;
