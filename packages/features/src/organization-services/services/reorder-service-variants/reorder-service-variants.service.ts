import {
  organizationServiceVariant,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, asc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ReorderServiceVariantsInput,
  reorderServiceVariantsSchema,
} from './reorder-service-variants.schema.js';

export interface ReorderServiceVariantsResponse {
  items: (typeof organizationServiceVariant.$inferSelect)[];
}

const reorderServiceVariantsImpl = async (
  db: DbConnection,
  input: ReorderServiceVariantsInput
): Promise<Result<ReorderServiceVariantsResponse>> => {
  const parsed = reorderServiceVariantsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, serviceId, orderedIds } = parsed.data;

  // Org-scope guard on the parent service.
  const service = await db.query.organizationService.findFirst({
    where: (svc, { eq: e, and: a }) =>
      a(e(svc.id, serviceId), e(svc.organizationId, organizationId)),
    columns: { id: true },
  });

  if (!service) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Service not found', {
        serviceId,
      })
    );
  }

  // Load the service's current variant ids so we can reject an `orderedIds` that
  // references a variant from another service (or that omits/duplicates rows).
  const current = await db.query.organizationServiceVariant.findMany({
    where: eq(organizationServiceVariant.serviceId, serviceId),
    columns: { id: true },
  });
  const currentIds = new Set(current.map((v) => v.id));

  const uniqueOrdered = new Set(orderedIds);
  if (
    uniqueOrdered.size !== orderedIds.length ||
    uniqueOrdered.size !== currentIds.size ||
    orderedIds.some((id) => !currentIds.has(id))
  ) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'orderedIds must list every variant of this service exactly once'
      )
    );
  }

  // Persist the new order: sortOrder = position in orderedIds. Scoped to the
  // service so a tampered id can never touch another service's rows.
  await Promise.all(
    orderedIds.map((id, index) =>
      db
        .update(organizationServiceVariant)
        .set({ sortOrder: index })
        .where(
          and(
            eq(organizationServiceVariant.id, id),
            eq(organizationServiceVariant.serviceId, serviceId)
          )
        )
    )
  );

  const items = await db.query.organizationServiceVariant.findMany({
    where: eq(organizationServiceVariant.serviceId, serviceId),
    orderBy: [asc(organizationServiceVariant.sortOrder)],
  });

  return ok({ items });
};

export const reorderServiceVariants = (
  db: DbConnection,
  input: ReorderServiceVariantsInput
) =>
  trackedResult(
    'organizationServices.reorderServiceVariants',
    () => withOrgScope((tx) => reorderServiceVariantsImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        serviceId: input.serviceId,
      },
    }
  );

export type ReorderServiceVariantsResult = Awaited<
  ReturnType<typeof reorderServiceVariants>
>;
