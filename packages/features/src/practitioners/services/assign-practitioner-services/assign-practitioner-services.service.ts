import {
  organizationService,
  practitioner,
  practitionerService,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
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
  type AssignPractitionerServicesInput,
  assignPractitionerServicesSchema,
} from './assign-practitioner-services.schema.js';

const assignPractitionerServicesImpl = async (
  db: DbConnection,
  input: AssignPractitionerServicesInput
): Promise<Result<{ practitionerId: string; serviceIds: string[] }>> => {
  const parsed = assignPractitionerServicesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { practitionerId, organizationId, serviceIds } = parsed.data;

  // Verify practitioner exists and belongs to org
  const existing = await db.query.practitioner.findFirst({
    where: and(
      eq(practitioner.id, practitionerId),
      eq(practitioner.organizationId, organizationId),
      notDeleted(practitioner)
    ),
  });

  if (!existing) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Practitioner not found')
    );
  }

  // Verify all services belong to the same org
  if (serviceIds.length > 0) {
    const services = await db.query.organizationService.findMany({
      where: and(
        inArray(organizationService.id, serviceIds),
        eq(organizationService.organizationId, organizationId)
      ),
    });

    if (services.length !== serviceIds.length) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'One or more services not found'
        )
      );
    }
  }

  try {
    // Delete existing assignments
    await db
      .delete(practitionerService)
      .where(eq(practitionerService.practitionerId, practitionerId));

    // Insert new assignments
    if (serviceIds.length > 0) {
      await db.insert(practitionerService).values(
        serviceIds.map((serviceId) => ({
          practitionerId,
          serviceId,
        }))
      );
    }

    return ok({ practitionerId, serviceIds });
  } catch (error) {
    logError('practitioners.assignPractitionerServices', error, {
      feature: 'practitioners',
      extra: { practitionerId, serviceIds },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to assign services')
    );
  }
};

export const assignPractitionerServices = (
  db: DbConnection,
  input: AssignPractitionerServicesInput
) =>
  trackedResult(
    'practitioners.assignPractitionerServices',
    () =>
      withOrgScope((tx) => assignPractitionerServicesImpl(tx, input), { db }),
    { properties: { practitionerId: input.practitionerId } }
  );

export type AssignPractitionerServicesResult = Awaited<
  ReturnType<typeof assignPractitionerServices>
>;
