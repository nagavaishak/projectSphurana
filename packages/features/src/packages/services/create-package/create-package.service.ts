import {
  organizationPackage,
  organizationPackageItem,
  organizationService,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CreatePackageInput,
  createPackageSchema,
} from './create-package.schema.js';

type PackageRow = typeof organizationPackage.$inferSelect;
type PackageItemRow = typeof organizationPackageItem.$inferSelect;

export interface CreatePackageResponse extends PackageRow {
  items: PackageItemRow[];
}

const createPackageImpl = async (
  db: DbConnection,
  input: CreatePackageInput
): Promise<Result<CreatePackageResponse>> => {
  const parsed = createPackageSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, name, items } = parsed.data;

  // Duplicate name check
  const existing = await db.query.organizationPackage.findFirst({
    where: and(
      eq(organizationPackage.organizationId, organizationId),
      eq(organizationPackage.name, name)
    ),
  });
  if (existing) {
    return err(
      new FeatureError(
        ErrorCodes.ALREADY_EXISTS,
        `Package "${name}" already exists in this organization`
      )
    );
  }

  // Validate all services belong to this org
  const serviceIds = items.map((i) => i.serviceId);
  if (new Set(serviceIds).size !== serviceIds.length) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Duplicate service IDs in items'
      )
    );
  }

  const services = await db
    .select({
      serviceId: organizationService.id,
      organizationId: organizationService.organizationId,
    })
    .from(organizationService)
    .where(inArray(organizationService.id, serviceIds));

  if (services.length !== serviceIds.length) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'One or more services do not exist'
      )
    );
  }

  if (services.some((s) => s.organizationId !== organizationId)) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'One or more services belong to a different organization'
      )
    );
  }

  // Validate categoryId belongs to org if provided
  const { categoryId } = parsed.data;
  if (categoryId) {
    const category = await db.query.organizationServiceCategory.findFirst({
      where: (cat, { eq: e, and: a }) =>
        a(e(cat.id, categoryId), e(cat.organizationId, organizationId)),
      columns: { id: true },
    });
    if (!category) {
      return err(
        new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Category not found')
      );
    }
  }

  return await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(organizationPackage)
      .values({
        organizationId,
        name,
        description: parsed.data.description ?? null,
        categoryId: parsed.data.categoryId ?? null,
        priceCents: parsed.data.priceCents,
        validityDays: parsed.data.validityDays ?? null,
        requiresDeposit: parsed.data.requiresDeposit,
        depositAmountCents: parsed.data.depositAmountCents ?? null,
        sortOrder: parsed.data.sortOrder,
        isActive: parsed.data.isActive,
      })
      .returning();

    const newItems = await tx
      .insert(organizationPackageItem)
      .values(
        items.map((item, idx) => ({
          packageId: created.id,
          serviceId: item.serviceId,
          quantity: item.quantity,
          sortOrder: item.sortOrder ?? idx,
        }))
      )
      .returning();

    return ok({ ...created, items: newItems });
  });
};

export const createPackage = (db: DbConnection, input: CreatePackageInput) =>
  trackedResult(
    'packages.createPackage',
    () => withOrgScope((tx) => createPackageImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId, name: input.name },
    }
  );

export type CreatePackageResult = Awaited<ReturnType<typeof createPackage>>;
