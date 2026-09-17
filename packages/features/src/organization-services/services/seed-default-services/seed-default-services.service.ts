import {
  defaultServicesByBusinessType,
  organizationService,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { resolveCategoryIdForEnum } from '../_internal/resolve-category-id.js';
import {
  type SeedDefaultServicesInput,
  seedDefaultServicesSchema,
} from './seed-default-services.schema.js';

/**
 * Internal implementation of seed default services
 */
const seedDefaultServicesImpl = async (
  db: DbConnection,
  input: SeedDefaultServicesInput
): Promise<Result<{ created: number; skipped: number }>> => {
  // Validate input
  const parsed = seedDefaultServicesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, businessType } = parsed.data;

  // Get default services for this business type
  const defaultServices = defaultServicesByBusinessType[businessType] || [];

  if (defaultServices.length === 0) {
    return ok({ created: 0, skipped: 0 });
  }

  // Check which services already exist
  const existingServices = await db.query.organizationService.findMany({
    where: (svc, { eq }) => eq(svc.organizationId, organizationId),
    columns: { name: true },
  });

  const existingNames = new Set(
    existingServices.map((s) => s.name.toLowerCase())
  );

  // Filter out services that already exist
  const servicesToCreate = defaultServices.filter(
    (name) => !existingNames.has(name.toLowerCase())
  );

  if (servicesToCreate.length === 0) {
    return ok({ created: 0, skipped: defaultServices.length });
  }

  // All seeded services use the 'treatment' category enum value, so the
  // backfill helper resolves them all to the same category row.
  const categoryId = await resolveCategoryIdForEnum(
    db,
    organizationId,
    'treatment'
  );

  // Create new services
  const newServices = servicesToCreate.map((name, index) => ({
    organizationId,
    name,
    category: 'treatment' as const,
    categoryId,
    sortOrder: existingServices.length + index,
    isCustom: false,
    isActive: true,
  }));

  await db
    .insert(organizationService)
    .values(newServices)
    .returning({ id: organizationService.id, name: organizationService.name });

  return ok({
    created: servicesToCreate.length,
    skipped: defaultServices.length - servicesToCreate.length,
  });
};

/**
 * Seed default services for an organization based on business type
 *
 * @param db - Database connection
 * @param input - Seed default services input
 * @returns Result with counts of created and skipped services
 */
export const seedDefaultServices = (
  db: DbConnection,
  input: SeedDefaultServicesInput
) =>
  trackedResult(
    'organizationServices.seedDefaultServices',
    () => withOrgScope((tx) => seedDefaultServicesImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        businessType: input.businessType,
      },
    }
  );

/**
 * Result type for seedDefaultServices
 */
export type SeedDefaultServicesResult = Awaited<
  ReturnType<typeof seedDefaultServices>
>;
