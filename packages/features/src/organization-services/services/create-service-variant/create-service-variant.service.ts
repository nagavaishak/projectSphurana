import {
  isUniqueViolation,
  organizationServiceVariant,
  withDbRetry,
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
import {
  type CreateServiceVariantInput,
  createServiceVariantSchema,
} from './create-service-variant.schema.js';

const createServiceVariantImpl = async (
  db: DbConnection,
  input: CreateServiceVariantInput
): Promise<Result<typeof organizationServiceVariant.$inferSelect>> => {
  const parsed = createServiceVariantSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, serviceId, name, sortOrder, isActive } = parsed.data;

  // Org-scope guard: the parent service must belong to the active org. A variant
  // carries no organization_id of its own (org scope is inherited via the FK),
  // so this lookup is the authorization check.
  const service = await withDbRetry(() =>
    db.query.organizationService.findFirst({
      where: (svc, { eq, and }) =>
        and(eq(svc.id, serviceId), eq(svc.organizationId, organizationId)),
      columns: { id: true },
    })
  );

  if (!service) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Service not found', {
        serviceId,
      })
    );
  }

  try {
    const [result] = await withDbRetry(() =>
      db
        .insert(organizationServiceVariant)
        .values({
          serviceId,
          name,
          priceCents: parsed.data.priceCents ?? null,
          durationMinutes: parsed.data.durationMinutes ?? null,
          sortOrder,
          isActive,
        })
        .returning()
    );

    return ok(result);
  } catch (error) {
    // drizzle wraps the postgres.js error — the constraint lives on the
    // `.cause` chain, not `error.message` (see isUniqueViolation).
    if (isUniqueViolation(error, 'organization_service_variant_name_unique')) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          `A variant named "${name}" already exists for this service`,
          { name }
        )
      );
    }
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to create variant')
    );
  }
};

export const createServiceVariant = (
  db: DbConnection,
  input: CreateServiceVariantInput
) =>
  trackedResult(
    'organizationServices.createServiceVariant',
    () => withOrgScope((tx) => createServiceVariantImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        serviceId: input.serviceId,
      },
    }
  );

export type CreateServiceVariantResult = Awaited<
  ReturnType<typeof createServiceVariant>
>;
