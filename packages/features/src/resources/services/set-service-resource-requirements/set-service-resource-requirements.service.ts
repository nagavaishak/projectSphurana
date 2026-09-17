import {
  organizationService,
  resource,
  resourceCategory,
  serviceResourceEligibility,
  serviceResourceRequirement,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
import { setServiceTurnaround } from '../../../organization-services/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type SetServiceResourceRequirementsInput,
  setServiceResourceRequirementsSchema,
} from './set-service-resource-requirements.schema.js';

interface SetServiceResourceRequirementsOutput {
  serviceId: string;
  turnaroundMinutes: number | null;
  requirements: Array<{ categoryId: string; eligibleResourceIds: string[] }>;
}

/**
 * Replace a service's ENTIRE requirement set in one transaction: one PUT, one
 * consistent state, no half-applied rule set that could gate bookings on a
 * requirement the clinic already removed.
 *
 * CRITICAL SEMANTIC: an empty `eligibleResourceIds` writes ZERO eligibility
 * rows, which the engine reads as "any resource in this category" — the same
 * org-wide-by-default convention `blocked_time` uses for zero practitioner
 * joins. Writing a row per resource instead would silently break the moment the
 * clinic adds a new room.
 */
const setServiceResourceRequirementsImpl = async (
  db: DbConnection,
  input: SetServiceResourceRequirementsInput
): Promise<Result<SetServiceResourceRequirementsOutput>> => {
  const parsed = setServiceResourceRequirementsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, serviceId, turnaroundMinutes, requirements } =
    parsed.data;

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

    const categoryIds = requirements.map((r) => r.categoryId);

    if (categoryIds.length > 0) {
      const categories = await db.query.resourceCategory.findMany({
        where: and(
          eq(resourceCategory.organizationId, organizationId),
          inArray(resourceCategory.id, categoryIds),
          notDeleted(resourceCategory)
        ),
        columns: { id: true },
      });

      if (categories.length !== categoryIds.length) {
        return err(
          new FeatureError(
            ErrorCodes.VALIDATION_ERROR,
            'One or more categories do not belong to this organization'
          )
        );
      }
    }

    const eligibleIds = requirements.flatMap((r) => r.eligibleResourceIds);

    if (eligibleIds.length > 0) {
      const resources = await db.query.resource.findMany({
        where: and(
          eq(resource.organizationId, organizationId),
          inArray(resource.id, eligibleIds),
          notDeleted(resource)
        ),
        columns: { id: true, categoryId: true },
      });

      const categoryByResource = new Map(
        resources.map((row) => [row.id, row.categoryId])
      );

      for (const requirement of requirements) {
        for (const resourceId of requirement.eligibleResourceIds) {
          if (categoryByResource.get(resourceId) !== requirement.categoryId) {
            return err(
              new FeatureError(
                ErrorCodes.VALIDATION_ERROR,
                'One or more eligible resources do not belong to their category'
              )
            );
          }
        }
      }
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(serviceResourceEligibility)
        .where(
          and(
            eq(serviceResourceEligibility.serviceId, serviceId),
            eq(serviceResourceEligibility.organizationId, organizationId)
          )
        );

      await tx
        .delete(serviceResourceRequirement)
        .where(
          and(
            eq(serviceResourceRequirement.serviceId, serviceId),
            eq(serviceResourceRequirement.organizationId, organizationId)
          )
        );

      if (requirements.length > 0) {
        await tx.insert(serviceResourceRequirement).values(
          requirements.map((requirement) => ({
            organizationId,
            serviceId,
            categoryId: requirement.categoryId,
            quantity: 1,
          }))
        );
      }

      // Zero rows for a category is the "any resource" contract — never expand
      // an empty selection into one row per resource.
      const eligibilityRows = requirements.flatMap((requirement) =>
        requirement.eligibleResourceIds.map((resourceId) => ({
          organizationId,
          serviceId,
          resourceId,
        }))
      );

      if (eligibilityRows.length > 0) {
        await tx.insert(serviceResourceEligibility).values(eligibilityRows);
      }

      // Turnaround lives on `organization_service`, which this feature does NOT
      // own. The write goes through `setServiceTurnaround`, which lives in that
      // table's owning directory, so the single-writer rule holds
      // (packages/features/src/architecture/single-writer.test.ts). Passing
      // `tx` keeps it in THIS transaction: requirements and turnaround are
      // configured on one screen and must commit together or not at all.
      if (turnaroundMinutes !== undefined) {
        await setServiceTurnaround(tx, {
          serviceId,
          organizationId,
          turnaroundMinutes,
        });
      }
    });

    return ok({
      serviceId,
      turnaroundMinutes:
        turnaroundMinutes === undefined
          ? (service.turnaroundMinutes ?? null)
          : turnaroundMinutes,
      requirements: requirements.map((requirement) => ({
        categoryId: requirement.categoryId,
        eligibleResourceIds: requirement.eligibleResourceIds,
      })),
    });
  } catch (error) {
    logError('resources.setServiceResourceRequirements', error, {
      feature: 'resources',
      extra: { organizationId, serviceId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to save service resource requirements'
      )
    );
  }
};

export const setServiceResourceRequirements = (
  db: DbConnection,
  input: SetServiceResourceRequirementsInput
) =>
  trackedResult(
    'resources.setServiceResourceRequirements',
    () =>
      withOrgScope((tx) => setServiceResourceRequirementsImpl(tx, input), {
        db,
      }),
    {
      properties: {
        organizationId: input.organizationId,
        serviceId: input.serviceId,
        requirementCount: input.requirements?.length,
      },
    }
  );

export type SetServiceResourceRequirementsResult = Awaited<
  ReturnType<typeof setServiceResourceRequirements>
>;
