import {
  type ConsentFormTemplate,
  consentFormTemplate,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CreateConsentFormTemplateInput,
  createConsentFormTemplateSchema,
} from './create-consent-form-template.schema.js';

const createConsentFormTemplateImpl = async (
  db: DbConnection,
  input: CreateConsentFormTemplateInput
): Promise<Result<ConsentFormTemplate>> => {
  const parsed = createConsentFormTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const [row] = await db
      .insert(consentFormTemplate)
      .values(parsed.data)
      .returning();

    return ok(row);
  } catch (error) {
    logError('consentForms.createConsentFormTemplate', error, {
      feature: 'consent-forms',
      extra: { organizationId: parsed.data.organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create consent form template'
      )
    );
  }
};

/** Staff-facing: create a consent-form template for the active org. */
export const createConsentFormTemplate = (
  db: DbConnection,
  input: CreateConsentFormTemplateInput
) =>
  trackedResult(
    'consentForms.createConsentFormTemplate',
    () =>
      withOrgScope((tx) => createConsentFormTemplateImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type CreateConsentFormTemplateResult = Awaited<
  ReturnType<typeof createConsentFormTemplate>
>;
