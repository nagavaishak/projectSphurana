import {
  consentFormTemplate,
  organizationService,
  organizationServiceFormRequirement,
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
  ok,
} from '../../../shared/index.js';
import {
  type SetServiceFormRequirementsInput,
  setServiceFormRequirementsSchema,
} from './set-service-form-requirements.schema.js';

export interface SetServiceFormRequirementsData {
  serviceId: string;
  templateIds: string[];
}

const setServiceFormRequirementsImpl = async (
  db: DbConnection,
  input: SetServiceFormRequirementsInput
): Promise<Result<SetServiceFormRequirementsData>> => {
  const parsed = setServiceFormRequirementsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, serviceId } = parsed.data;
  const templateIds = [...new Set(parsed.data.templateIds)];

  try {
    const service = await db.query.organizationService.findFirst({
      where: and(
        eq(organizationService.id, serviceId),
        eq(organizationService.organizationId, organizationId)
      ),
      columns: { id: true },
    });

    if (!service) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Service not found'));
    }

    if (templateIds.length > 0) {
      // Every requested template must exist AND belong to this org — a foreign
      // templateId must not be attachable to our service.
      const templates = await db.query.consentFormTemplate.findMany({
        where: and(
          inArray(consentFormTemplate.id, templateIds),
          eq(consentFormTemplate.organizationId, organizationId)
        ),
        columns: { id: true },
      });
      if (templates.length !== templateIds.length) {
        return err(
          new FeatureError(
            ErrorCodes.NOT_FOUND,
            'One or more consent form templates were not found'
          )
        );
      }
    }

    // Reconcile the join table to exactly the requested set.
    const existing = await db.query.organizationServiceFormRequirement.findMany(
      {
        where: eq(organizationServiceFormRequirement.serviceId, serviceId),
      }
    );

    const wanted = new Set(templateIds);
    const existingIds = new Set(existing.map((row) => row.templateId));

    const toRemove = existing
      .filter((row) => !wanted.has(row.templateId))
      .map((row) => row.templateId);
    const toAdd = templateIds.filter((id) => !existingIds.has(id));

    if (toRemove.length > 0) {
      await db
        .delete(organizationServiceFormRequirement)
        .where(
          and(
            eq(organizationServiceFormRequirement.serviceId, serviceId),
            inArray(organizationServiceFormRequirement.templateId, toRemove)
          )
        );
    }

    if (toAdd.length > 0) {
      await db
        .insert(organizationServiceFormRequirement)
        .values(toAdd.map((templateId) => ({ serviceId, templateId })))
        .onConflictDoNothing();
    }

    return ok({ serviceId, templateIds });
  } catch (error) {
    logError('consentForms.setServiceFormRequirements', error, {
      feature: 'consent-forms',
      extra: { serviceId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update the service form requirements'
      )
    );
  }
};

/** Staff-facing: set which consent forms a service requires (exact set). */
export const setServiceFormRequirements = (
  db: DbConnection,
  input: SetServiceFormRequirementsInput
) =>
  trackedResult(
    'consentForms.setServiceFormRequirements',
    () =>
      withOrgScope((tx) => setServiceFormRequirementsImpl(tx, input), { db }),
    {
      properties: {
        serviceId: input.serviceId,
        organizationId: input.organizationId,
      },
    }
  );

export type SetServiceFormRequirementsResult = Awaited<
  ReturnType<typeof setServiceFormRequirements>
>;
