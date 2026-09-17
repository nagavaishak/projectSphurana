import {
  consentFormSubmission,
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
  type DeleteConsentFormTemplateInput,
  deleteConsentFormTemplateSchema,
} from './delete-consent-form-template.schema.js';

export interface DeleteConsentFormTemplateData {
  id: string;
  /**
   * True when the template was deactivated instead of removed — submissions
   * reference it (templateId is ON DELETE RESTRICT), so a hard delete would
   * both fail and orphan signed records.
   */
  softDeleted: boolean;
}

const deleteConsentFormTemplateImpl = async (
  db: DbConnection,
  input: DeleteConsentFormTemplateInput
): Promise<Result<DeleteConsentFormTemplateData>> => {
  const parsed = deleteConsentFormTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId } = parsed.data;

  try {
    const template = await db.query.consentFormTemplate.findFirst({
      where: and(
        eq(consentFormTemplate.id, id),
        eq(consentFormTemplate.organizationId, organizationId)
      ),
    });

    if (!template) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          'Consent form template not found'
        )
      );
    }

    const referencingSubmission =
      await db.query.consentFormSubmission.findFirst({
        where: and(
          eq(consentFormSubmission.templateId, id),
          eq(consentFormSubmission.organizationId, organizationId)
        ),
        columns: { id: true },
      });

    if (referencingSubmission) {
      // Soft delete: submissions point at this template.
      await db
        .update(consentFormTemplate)
        .set({ isActive: false })
        .where(
          and(
            eq(consentFormTemplate.id, id),
            eq(consentFormTemplate.organizationId, organizationId)
          )
        );
      return ok({ id, softDeleted: true });
    }

    // Hard delete: no submissions reference it. Join-table rows cascade.
    await db
      .delete(consentFormTemplate)
      .where(
        and(
          eq(consentFormTemplate.id, id),
          eq(consentFormTemplate.organizationId, organizationId)
        )
      );

    return ok({ id, softDeleted: false });
  } catch (error) {
    logError('consentForms.deleteConsentFormTemplate', error, {
      feature: 'consent-forms',
      extra: { id, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to delete consent form template'
      )
    );
  }
};

/**
 * Staff-facing: delete a template. Soft-deactivates when submissions reference
 * it (their snapshot is what the patient signed); hard-deletes otherwise.
 */
export const deleteConsentFormTemplate = (
  db: DbConnection,
  input: DeleteConsentFormTemplateInput
) =>
  trackedResult(
    'consentForms.deleteConsentFormTemplate',
    () =>
      withOrgScope((tx) => deleteConsentFormTemplateImpl(tx, input), { db }),
    { properties: { id: input.id, organizationId: input.organizationId } }
  );

export type DeleteConsentFormTemplateResult = Awaited<
  ReturnType<typeof deleteConsentFormTemplate>
>;
