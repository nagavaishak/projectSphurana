import {
  organizationService,
  serviceResourceEligibility,
  serviceResourceRequirement,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { ServiceResourceRequirements } from '../../models/index.js';
import {
  type GetServiceResourceRequirementsInput,
  getServiceResourceRequirementsSchema,
} from './get-service-resource-requirements.schema.js';

/**
 * The service editor's resource tab: which categories this service needs, which
 * resources within each are eligible, and the turnaround buffer.
 *
 * An empty `eligibleResourceIds` is the meaningful default, not missing data —
 * it means "any resource in this category", exactly as zero rows mean in the DB.
 */
const getServiceResourceRequirementsImpl = async (
  db: DbConnection,
  input: GetServiceResourceRequirementsInput
): Promise<Result<ServiceResourceRequirements>> => {
  const parsed = getServiceResourceRequirementsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, serviceId } = parsed.data;

  try {
    const service = await db.query.organizationService.findFirst({
      where: and(
        eq(organizationService.id, serviceId),
        eq(organizationService.organizationId, organizationId)
      ),
      columns: { id: true, turnaroundMinutes: true },
    });

    if (!service) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Service not found'));
    }

    const requirements = await db.query.serviceResourceRequirement.findMany({
      where: and(
        eq(serviceResourceRequirement.serviceId, serviceId),
        eq(serviceResourceRequirement.organizationId, organizationId)
      ),
      with: {
        category: { columns: { id: true, name: true, kind: true } },
      },
    });

    const eligibility = await db.query.serviceResourceEligibility.findMany({
      where: and(
        eq(serviceResourceEligibility.serviceId, serviceId),
        eq(serviceResourceEligibility.organizationId, organizationId)
      ),
      with: {
        resource: { columns: { id: true, categoryId: true } },
      },
    });

    const eligibleByCategory = new Map<string, string[]>();
    for (const row of eligibility) {
      if (!row.resource) continue;
      const existing = eligibleByCategory.get(row.resource.categoryId) ?? [];
      existing.push(row.resource.id);
      eligibleByCategory.set(row.resource.categoryId, existing);
    }

    return ok({
      serviceId,
      turnaroundMinutes: service.turnaroundMinutes ?? null,
      requirements: requirements.map((requirement) => ({
        categoryId: requirement.categoryId,
        categoryName: requirement.category.name,
        categoryKind: requirement.category.kind,
        eligibleResourceIds:
          eligibleByCategory.get(requirement.categoryId) ?? [],
      })),
    });
  } catch (error) {
    logError('resources.getServiceResourceRequirements', error, {
      feature: 'resources',
      extra: { organizationId, serviceId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to load service resource requirements'
      )
    );
  }
};

export const getServiceResourceRequirements = (
  db: DbConnection,
  input: GetServiceResourceRequirementsInput
) =>
  trackedResult(
    'resources.getServiceResourceRequirements',
    () =>
      withOrgScope((tx) => getServiceResourceRequirementsImpl(tx, input), {
        db,
      }),
    {
      properties: {
        organizationId: input.organizationId,
        serviceId: input.serviceId,
      },
      internalErrorsOnly: true,
    }
  );

export type GetServiceResourceRequirementsResult = Awaited<
  ReturnType<typeof getServiceResourceRequirements>
>;
