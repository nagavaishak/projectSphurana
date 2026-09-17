import {
  type ConsentFormTemplate,
  consentFormTemplate,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { type SQL, and, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListConsentFormTemplatesInput,
  listConsentFormTemplatesSchema,
} from './list-consent-form-templates.schema.js';

const listConsentFormTemplatesImpl = async (
  db: DbConnection,
  input: ListConsentFormTemplatesInput
): Promise<Result<{ items: ConsentFormTemplate[] }>> => {
  const parsed = listConsentFormTemplatesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, activeOnly } = parsed.data;

  try {
    const conditions: SQL[] = [
      eq(consentFormTemplate.organizationId, organizationId),
    ];
    if (activeOnly) {
      conditions.push(eq(consentFormTemplate.isActive, true));
    }

    const items = await db.query.consentFormTemplate.findMany({
      where: and(...conditions),
      orderBy: [desc(consentFormTemplate.createdAt)],
    });

    return ok({ items });
  } catch (error) {
    logError('consentForms.listConsentFormTemplates', error, {
      feature: 'consent-forms',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to list consent form templates'
      )
    );
  }
};

/** Staff-facing: list the org's consent-form templates. */
export const listConsentFormTemplates = (
  db: DbConnection,
  input: ListConsentFormTemplatesInput
) =>
  trackedResult(
    'consentForms.listConsentFormTemplates',
    () => withOrgScope((tx) => listConsentFormTemplatesImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type ListConsentFormTemplatesResult = Awaited<
  ReturnType<typeof listConsentFormTemplates>
>;
