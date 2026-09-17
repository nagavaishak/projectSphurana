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
  type ListServiceVariantsInput,
  listServiceVariantsSchema,
} from './list-service-variants.schema.js';

export interface ListServiceVariantsResponse {
  items: (typeof organizationServiceVariant.$inferSelect)[];
}

const listServiceVariantsImpl = async (
  db: DbConnection,
  input: ListServiceVariantsInput
): Promise<Result<ListServiceVariantsResponse>> => {
  const parsed = listServiceVariantsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, serviceId, activeOnly } = parsed.data;

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

  const items = await db.query.organizationServiceVariant.findMany({
    where: activeOnly
      ? and(
          eq(organizationServiceVariant.serviceId, serviceId),
          eq(organizationServiceVariant.isActive, true)
        )
      : eq(organizationServiceVariant.serviceId, serviceId),
    orderBy: [asc(organizationServiceVariant.sortOrder)],
  });

  return ok({ items });
};

export const listServiceVariants = (
  db: DbConnection,
  input: ListServiceVariantsInput
) =>
  trackedResult(
    'organizationServices.listServiceVariants',
    () => withOrgScope((tx) => listServiceVariantsImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        serviceId: input.serviceId,
      },
    }
  );

export type ListServiceVariantsResult = Awaited<
  ReturnType<typeof listServiceVariants>
>;
