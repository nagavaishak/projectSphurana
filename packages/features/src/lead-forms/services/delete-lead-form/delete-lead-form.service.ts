import {
  leadForm,
  metaAd,
  metaAdsIntegration,
  withOrgScope,
} from '@borradh-workspace/database';
import {
  MetaAdsService,
  decryptCredentials,
} from '@borradh-workspace/integrations';
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
  type DeleteLeadFormInput,
  deleteLeadFormSchema,
} from './delete-lead-form.schema.js';

/**
 * Internal implementation of delete lead form
 */
const deleteLeadFormImpl = async (
  db: DbConnection,
  input: DeleteLeadFormInput
): Promise<Result<{ success: boolean }>> => {
  // Validate input
  const parsed = deleteLeadFormSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId } = parsed.data;

  // Build where clause
  const conditions = [eq(leadForm.id, id)];
  if (organizationId) {
    conditions.push(eq(leadForm.organizationId, organizationId));
  }

  // Check if form exists
  const existing = await db.query.leadForm.findFirst({
    where: and(...conditions),
  });

  if (!existing) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Lead form not found', { id })
    );
  }

  // Check if form is used by any ads
  const usedByAds = await db.query.metaAd.findFirst({
    where: eq(metaAd.leadFormId, id),
  });

  if (usedByAds) {
    // Don't delete, just archive since it's in use
    await db
      .update(leadForm)
      .set({ status: 'archived' })
      .where(eq(leadForm.id, id));

    return ok({ success: true });
  }

  // If form has been synced to Meta, archive it there too
  if (existing.metaFormId) {
    try {
      // Get Meta integration
      const integration = await db.query.metaAdsIntegration.findFirst({
        where: eq(metaAdsIntegration.organizationId, existing.organizationId),
      });

      if (integration?.isActive && integration.adAccountId) {
        const credentials = decryptCredentials<{ accessToken: string }>(
          integration.encryptedCredentials
        );

        const metaService = new MetaAdsService({
          accessToken: credentials.accessToken,
          adAccountId: integration.adAccountId,
          pageId: integration.defaultPageId || '',
          appSecret: process.env.META_APP_SECRET || undefined,
        });

        // Archive on Meta (lead forms can't be deleted, only archived)
        await metaService.archiveLeadGenForm(existing.metaFormId);
      }
    } catch (error) {
      // Log error but don't fail the deletion
      logError('leadForms.deleteLeadForm', error, {
        feature: 'lead-forms',
        extra: { leadFormId: id, metaFormId: existing.metaFormId },
      });
    }
  }

  // Archive the form locally (we don't hard delete to preserve history)
  await db
    .update(leadForm)
    .set({ status: 'archived' })
    .where(eq(leadForm.id, id));

  return ok({ success: true });
};

/**
 * Delete (archive) a lead form
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Delete input with lead form ID
 * @returns Result with success status or error
 *
 * @example
 * ```ts
 * const result = await deleteLeadForm(db, {
 *   id: 'form_123',
 *   organizationId: 'org_123',
 * });
 * ```
 */
export const deleteLeadForm = (db: DbConnection, input: DeleteLeadFormInput) =>
  trackedResult(
    'leadForms.deleteLeadForm',
    () => withOrgScope((tx) => deleteLeadFormImpl(tx, input), { db }),
    { properties: { id: input.id } }
  );

/**
 * Result type for deleteLeadForm
 */
export type DeleteLeadFormResult = Awaited<ReturnType<typeof deleteLeadForm>>;
