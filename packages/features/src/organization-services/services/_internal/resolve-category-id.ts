import {
  type ServiceCategory,
  organizationServiceCategory,
} from '@borradh-workspace/database';
import { serviceCategoryLabels } from '@borradh-workspace/labels';
import { and, eq } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';

/**
 * Resolve (or create) the per-org category row that corresponds to a legacy
 * `service_category` enum value. Used by service writers during the Phase 2
 * cutover so every new `organization_service` row carries a `categoryId`
 * even though the calling code still speaks the enum.
 *
 * Phase 3 will replace enum-typed inputs with explicit categoryIds and this
 * helper will go away.
 */
export async function resolveCategoryIdForEnum(
  db: DbConnection,
  organizationId: string,
  category: ServiceCategory
): Promise<string> {
  const name = serviceCategoryLabels[category];

  const existing = await db.query.organizationServiceCategory.findFirst({
    where: and(
      eq(organizationServiceCategory.organizationId, organizationId),
      eq(organizationServiceCategory.name, name)
    ),
  });
  if (existing) return existing.id;

  const [created] = await db
    .insert(organizationServiceCategory)
    .values({
      organizationId,
      name,
      sortOrder: 0,
    })
    .onConflictDoNothing({
      target: [
        organizationServiceCategory.organizationId,
        organizationServiceCategory.name,
      ],
    })
    .returning();

  if (created) return created.id;

  // Lost a race with another insert — re-read.
  const raced = await db.query.organizationServiceCategory.findFirst({
    where: and(
      eq(organizationServiceCategory.organizationId, organizationId),
      eq(organizationServiceCategory.name, name)
    ),
  });
  if (!raced) {
    throw new Error(
      `resolveCategoryIdForEnum: could not resolve or create category "${name}" for org ${organizationId}`
    );
  }
  return raced.id;
}
