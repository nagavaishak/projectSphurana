import {
  type OrganizationServiceVariant,
  organizationService,
  organizationServiceLocation,
  organizationServiceVariant,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { type SQL, and, asc, eq, inArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  applyServiceLocationOverride,
  applyVariantLocationOverride,
  atLocationOrUnassigned,
  err,
  loadServiceLocationOverrides,
  loadVariantLocationOverrides,
  ok,
} from '../../../shared/index.js';
import type { ServiceWithRelations } from '../get-service/index.js';
import {
  listServiceIdsWithMedia,
  listServiceIdsWithVideoFootage,
} from '../list-services-with-media/index.js';
import {
  type ListServicesInput,
  listServicesSchema,
} from './list-services.schema.js';

/**
 * A listed service plus `hasGraphicMedia` — whether the service has uploaded
 * media (photos / video screenshots) usable for a graphic. The
 * generate-graphic picker uses this to restrict selectable services when the
 * "Use AI-generated images" toggle is off.
 */
export type ListedService = ServiceWithRelations & {
  hasGraphicMedia: boolean;
  /** Whether the service has its OWN uploaded video clips — the gate for
   *  organic video content (the batch never borrows another service's
   *  footage). The "Create Batch" dialog uses this to prompt for upload. */
  hasVideoFootage: boolean;
  /** All of the service's variants (active + inactive), by sortOrder — so the
   *  dashboard service form can load and edit them. Empty for single-price
   *  services. */
  variants: OrganizationServiceVariant[];
  /**
   * The branches that offer this service.
   *
   * EMPTY MEANS EVERYWHERE — the same empty-junction convention the read path
   * already uses (`atLocationOrUnassigned`), not "offered nowhere". Surfaces
   * that group services by branch (the promotion editor's service picker) need
   * the links, and re-deriving them client-side is impossible: the join table
   * has never been exposed.
   */
  locationIds: string[];
};

export interface ListServicesResponse {
  items: ListedService[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Internal implementation of list services
 */
const listServicesImpl = async (
  db: DbConnection,
  input: ListServicesInput
): Promise<Result<ListServicesResponse>> => {
  // Validate input
  const parsed = listServicesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, locationId, category, isActive, limit, offset } =
    parsed.data;

  // Build where conditions
  const conditions: SQL[] = [
    eq(organizationService.organizationId, organizationId),
  ];

  // "Offered at this branch" = has a join row for it, OR has no join rows at
  // all (the "everywhere" default — see `atLocationOrUnassigned`). Every org's
  // join table is empty today, so this is a no-op until someone assigns.
  if (locationId) {
    conditions.push(
      atLocationOrUnassigned(
        db,
        organizationServiceLocation,
        organizationServiceLocation.serviceId,
        organizationService.id,
        organizationServiceLocation.locationId,
        locationId
      )
    );
  }

  if (category !== undefined) {
    conditions.push(eq(organizationService.category, category));
  }

  if (isActive !== undefined) {
    conditions.push(eq(organizationService.isActive, isActive));
  }

  const whereClause = and(...conditions);

  const rows = (await db.query.organizationService.findMany({
    where: whereClause,
    orderBy: [
      asc(organizationService.sortOrder),
      asc(organizationService.name),
    ],
    limit,
    offset,
  })) as ServiceWithRelations[];

  // Annotate each service with its media availability per modality:
  //  - hasGraphicMedia → graphic-eligible uploaded media (photos / video
  //    screenshots), used by the generate-graphic picker.
  //  - hasVideoFootage → the service's OWN video clips, used by the
  //    "Create Batch" dialog to gate / prompt video uploads.
  // Best-effort: a failed lookup treats services as having no media rather
  // than failing the whole list.
  const [mediaResult, videoFootageResult] = await Promise.all([
    listServiceIdsWithMedia(db, { organizationId }),
    listServiceIdsWithVideoFootage(db, { organizationId }),
  ]);
  const mediaServiceIds = new Set(mediaResult.success ? mediaResult.data : []);
  const videoFootageServiceIds = new Set(
    videoFootageResult.success ? videoFootageResult.data : []
  );

  // Variants for the listed services, by sortOrder — grouped for O(1) attach.
  // All variants (active + inactive) so the dashboard editor can manage them.
  const rowIds = rows.map((r) => r.id);
  const variantRows =
    rowIds.length > 0
      ? await db.query.organizationServiceVariant.findMany({
          where: inArray(organizationServiceVariant.serviceId, rowIds),
          orderBy: [asc(organizationServiceVariant.sortOrder)],
        })
      : [];
  // Per-branch VARIANT prices. Separate from the service-level override
  // because a variant-priced service has no single price to override — see
  // `loadVariantLocationOverrides`.
  const variantOverrides = await loadVariantLocationOverrides(db, {
    variantIds: variantRows.map((v) => v.id),
    locationId,
  });

  const variantsByService = new Map<string, OrganizationServiceVariant[]>();
  for (const raw of variantRows) {
    const v = applyVariantLocationOverride(raw, variantOverrides.get(raw.id));
    const list = variantsByService.get(v.serviceId) ?? [];
    list.push(v);
    variantsByService.set(v.serviceId, list);
  }

  // Branch links, grouped for O(1) attach. Note this is deliberately NOT
  // filtered by `locationId`: when a branch is active the list is already
  // restricted to services offered there, but each surviving service still
  // reports every branch it belongs to.
  const locationRows =
    rowIds.length > 0
      ? await db.query.organizationServiceLocation.findMany({
          where: inArray(organizationServiceLocation.serviceId, rowIds),
          columns: { serviceId: true, locationId: true },
        })
      : [];
  const locationsByService = new Map<string, string[]>();
  for (const link of locationRows) {
    const list = locationsByService.get(link.serviceId) ?? [];
    list.push(link.locationId);
    locationsByService.set(link.serviceId, list);
  }

  // Per-branch price / duration. Shared with the detail read and BOTH public
  // surfaces (`loadServiceLocationOverrides`) so a customer is never quoted
  // one number on the branch page and another in the dashboard.
  const overrides = await loadServiceLocationOverrides(db, {
    serviceIds: rowIds,
    locationId,
  });

  const items: ListedService[] = rows.map((row) => ({
    ...applyServiceLocationOverride(row, overrides.get(row.id)),
    hasGraphicMedia: mediaServiceIds.has(row.id),
    hasVideoFootage: videoFootageServiceIds.has(row.id),
    variants: variantsByService.get(row.id) ?? [],
    locationIds: locationsByService.get(row.id) ?? [],
  }));

  // Get total count
  const allItems = await db.query.organizationService.findMany({
    where: whereClause,
    columns: { id: true },
  });

  return ok({
    items,
    total: allItems.length,
    limit,
    offset,
  });
};

/**
 * List organization services with optional filters
 *
 * @param db - Database connection
 * @param input - List services input with filters
 * @returns Result with paginated services or error
 */
export const listServices = (db: DbConnection, input: ListServicesInput) =>
  trackedResult(
    'organizationServices.listServices',
    () => withOrgScope((tx) => listServicesImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

/**
 * Result type for listServices
 */
export type ListServicesResult = Awaited<ReturnType<typeof listServices>>;
