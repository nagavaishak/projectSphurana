import { organizationServiceCategory } from '@borradh-workspace/database';
import { and, asc, eq } from 'drizzle-orm';
import type { DbConnection } from './core/types.js';

/**
 * id → name for an org's ACTIVE service categories, in the org's own display
 * order (insertion order is the category sort order, so a caller can derive
 * chip order from this map rather than sorting again).
 */
export const loadServiceCategoryNames = async (
  tx: DbConnection,
  organizationId: string
): Promise<Map<string, string>> => {
  const rows = await tx.query.organizationServiceCategory.findMany({
    where: and(
      eq(organizationServiceCategory.organizationId, organizationId),
      eq(organizationServiceCategory.isActive, true)
    ),
    orderBy: [asc(organizationServiceCategory.sortOrder)],
  });
  return new Map(rows.map((r) => [r.id, r.name]));
};

/**
 * A service's DISPLAY category name, or `null` when the org has not filed it
 * under one.
 *
 * The org's real, user-managed categories live in
 * `organization_service_category` and hang off
 * `organization_service.category_id` — that is what the dashboard shows and
 * the only thing a customer should ever see.
 *
 * There is deliberately NO fallback to the legacy `category` pgEnum. That
 * column predates the categories table and DEFAULTS to 'treatment', so it is
 * the same value for almost every service in the estate: 72 of 101 orgs with a
 * live catalogue have nothing categorised at all. Surfacing its label produced
 * a single "Treatment" chip that matched every service and filtered nothing —
 * a category the org never chose, presented to customers as though it had.
 * Null is the honest answer, and lets the page drop the chip row entirely.
 */
export const serviceCategoryName = (
  service: { categoryId: string | null },
  namesById: ReadonlyMap<string, string>
): string | null =>
  (service.categoryId ? namesById.get(service.categoryId) : undefined) ?? null;
