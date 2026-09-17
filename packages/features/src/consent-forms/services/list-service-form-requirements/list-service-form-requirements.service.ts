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
  type ListServiceFormRequirementsInput,
  listServiceFormRequirementsSchema,
} from './list-service-form-requirements.schema.js';

export interface ServiceFormRequirementItem {
  /** organization_service_form_requirement.id */
  id: string;
  templateId: string;
  title: string;
  requiresSignature: boolean;
  isActive: boolean;
}

const listServiceFormRequirementsImpl = async (
  db: DbConnection,
  input: ListServiceFormRequirementsInput
): Promise<Result<{ items: ServiceFormRequirementItem[] }>> => {
  const parsed = listServiceFormRequirementsSchema.safeParse(input);
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
      columns: { id: true },
    });

    if (!service) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Service not found'));
    }

    const requirements =
      await db.query.organizationServiceFormRequirement.findMany({
        where: eq(organizationServiceFormRequirement.serviceId, serviceId),
      });

    if (requirements.length === 0) {
      return ok({ items: [] });
    }

    const templates = await db.query.consentFormTemplate.findMany({
      where: and(
        inArray(
          consentFormTemplate.id,
          requirements.map((row) => row.templateId)
        ),
        eq(consentFormTemplate.organizationId, organizationId)
      ),
    });
    const templateById = new Map(templates.map((t) => [t.id, t]));

    const items = requirements.flatMap((row) => {
      const template = templateById.get(row.templateId);
      if (!template) return [];
      return [
        {
          id: row.id,
          templateId: template.id,
          title: template.title,
          requiresSignature: template.requiresSignature,
          isActive: template.isActive,
        },
      ];
    });

    return ok({ items });
  } catch (error) {
    logError('consentForms.listServiceFormRequirements', error, {
      feature: 'consent-forms',
      extra: { serviceId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to list the service form requirements'
      )
    );
  }
};

/** Staff-facing: list the consent forms a service requires. */
export const listServiceFormRequirements = (
  db: DbConnection,
  input: ListServiceFormRequirementsInput
) =>
  trackedResult(
    'consentForms.listServiceFormRequirements',
    () =>
      withOrgScope((tx) => listServiceFormRequirementsImpl(tx, input), { db }),
    {
      properties: {
        serviceId: input.serviceId,
        organizationId: input.organizationId,
      },
    }
  );

export type ListServiceFormRequirementsResult = Awaited<
  ReturnType<typeof listServiceFormRequirements>
>;
