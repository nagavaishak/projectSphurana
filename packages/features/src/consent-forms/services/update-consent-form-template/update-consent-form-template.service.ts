import {
  type ConsentFormTemplate,
  consentFormTemplate,
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
import {
  type UpdateConsentFormTemplateInput,
  updateConsentFormTemplateSchema,
} from './update-consent-form-template.schema.js';

/**
 * NOTE: editing a template NEVER rewrites already-sent submissions — they
 * carry a frozen `templateSnapshot` precisely so a later edit cannot silently
 * change what a patient signed.
 */
const updateConsentFormTemplateImpl = async (
  db: DbConnection,
  input: UpdateConsentFormTemplateInput
): Promise<Result<ConsentFormTemplate>> => {
  const parsed = updateConsentFormTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, ...changes } = parsed.data;

  try {
    const [row] = await db
      .update(consentFormTemplate)
      .set(changes)
      .where(
        and(
          eq(consentFormTemplate.id, id),
          eq(consentFormTemplate.organizationId, organizationId)
        )
      )
      .returning();

    if (!row) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          'Consent form template not found'
        )
      );
    }

    return ok(row);
  } catch (error) {
    logError('consentForms.updateConsentFormTemplate', error, {
      feature: 'consent-forms',
      extra: { id, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update consent form template'
      )
    );
  }
};

/** Staff-facing: update a consent-form template (org-scoped). */
export const updateConsentFormTemplate = (
  db: DbConnection,
  input: UpdateConsentFormTemplateInput
) =>
  trackedResult(
    'consentForms.updateConsentFormTemplate',
    () =>
      withOrgScope((tx) => updateConsentFormTemplateImpl(tx, input), { db }),
    { properties: { id: input.id, organizationId: input.organizationId } }
  );

export type UpdateConsentFormTemplateResult = Awaited<
  ReturnType<typeof updateConsentFormTemplate>
>;
