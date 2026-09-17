import {
  type LeadForm,
  leadForm,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { syncLeadFormToMeta } from '../sync-lead-form-to-meta/sync-lead-form-to-meta.service.js';
import {
  type UpdateLeadFormInput,
  updateLeadFormInputSchema,
} from './update-lead-form.schema.js';

/**
 * Internal implementation of update lead form
 */
const updateLeadFormImpl = async (
  db: DbConnection,
  input: UpdateLeadFormInput
): Promise<Result<LeadForm>> => {
  // Validate input
  const parsed = updateLeadFormInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, syncToMeta, ...updates } = parsed.data;

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

  // Enforce the WhatsApp pairing invariant (ENG-629 #4) against the EFFECTIVE
  // MERGED state, not just the payload. The stateless schema refine only sees
  // the incoming fields, so a partial `PUT` that blanks `whatsappNumber` (or
  // omits `followUpChannel`) on a form already set to `whatsapp` would slip past
  // it and write the exact forbidden state (channel=whatsapp + no number).
  // `in` distinguishes an explicitly-cleared number (key present as '' / null)
  // from an untouched one (key absent → keep the existing value).
  const whatsappNumberProvided = 'whatsappNumber' in updates;
  const effectiveChannel = updates.followUpChannel ?? existing.followUpChannel;
  const effectiveNumber = whatsappNumberProvided
    ? updates.whatsappNumber
    : existing.whatsappNumber;
  if (
    effectiveChannel === 'whatsapp' &&
    (effectiveNumber == null || effectiveNumber.trim() === '')
  ) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'A WhatsApp business number is required when the follow-up channel is WhatsApp.'
      )
    );
  }

  // Check for duplicate name if name is being changed
  if (updates.name && updates.name !== existing.name) {
    const duplicate = await db.query.leadForm.findFirst({
      where: and(
        eq(leadForm.organizationId, existing.organizationId),
        eq(leadForm.name, updates.name)
      ),
    });

    if (duplicate) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          `Lead form with name "${updates.name}" already exists`,
          { name: updates.name }
        )
      );
    }
  }

  // Build update object, only include fields that are explicitly provided
  const updateData: Partial<typeof leadForm.$inferInsert> = {};

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.questions !== undefined) updateData.questions = updates.questions;
  if (updates.privacyPolicyUrl !== undefined)
    updateData.privacyPolicyUrl = updates.privacyPolicyUrl;
  if (updates.privacyPolicyLinkText !== undefined)
    updateData.privacyPolicyLinkText = updates.privacyPolicyLinkText;
  if (updates.thankYouTitle !== undefined)
    updateData.thankYouTitle = updates.thankYouTitle;
  if (updates.thankYouBody !== undefined)
    updateData.thankYouBody = updates.thankYouBody;
  if (updates.thankYouButtonText !== undefined)
    updateData.thankYouButtonText = updates.thankYouButtonText;
  if (updates.thankYouButtonUrl !== undefined)
    updateData.thankYouButtonUrl = updates.thankYouButtonUrl;
  if (updates.followUpChannel !== undefined)
    updateData.followUpChannel = updates.followUpChannel;
  if (updates.whatsappNumber !== undefined)
    updateData.whatsappNumber = updates.whatsappNumber;
  if (updates.metaPageId !== undefined)
    updateData.metaPageId = updates.metaPageId;

  // If any content fields changed, mark as needing re-sync
  const contentChanged =
    updates.name !== undefined ||
    updates.questions !== undefined ||
    updates.privacyPolicyUrl !== undefined ||
    updates.privacyPolicyLinkText !== undefined ||
    updates.thankYouTitle !== undefined ||
    updates.thankYouBody !== undefined ||
    updates.thankYouButtonText !== undefined ||
    updates.thankYouButtonUrl !== undefined ||
    updates.followUpChannel !== undefined ||
    updates.whatsappNumber !== undefined;

  if (contentChanged && existing.metaFormId) {
    // Form has been synced before, mark as draft to indicate it needs re-sync
    updateData.status = 'draft';
  }

  // Update the form
  const [updatedForm] = await db
    .update(leadForm)
    .set(updateData)
    .where(eq(leadForm.id, id))
    .returning();

  // If syncToMeta is true, sync to Meta
  if (syncToMeta) {
    const syncResult = await syncLeadFormToMeta(db, { leadFormId: id });
    if (syncResult.success) {
      return ok(syncResult.data);
    }

    // Sync failed. The sync service has already persisted `status: 'error'` +
    // the reason in `syncError` on the row. Returning the stale pre-sync
    // `updatedForm` (`status: 'draft'`, `syncError: null`) here would report a
    // clean success and hide the failure from the caller/UI. Re-read the
    // authoritative row so callers see the real error state and reason. The form
    // still exists, so this stays an honest `ok` rather than a write failure.
    const persisted = await db.query.leadForm.findFirst({
      where: eq(leadForm.id, id),
    });
    return ok(persisted ?? updatedForm);
  }

  return ok(updatedForm);
};

/**
 * Update a lead form
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Update input with lead form ID and updates
 * @returns Result with updated lead form or error
 *
 * @example
 * ```ts
 * const result = await updateLeadForm(db, {
 *   id: 'form_123',
 *   name: 'Updated Form Name',
 *   syncToMeta: true,
 * });
 * ```
 */
export const updateLeadForm = (db: DbConnection, input: UpdateLeadFormInput) =>
  trackedResult(
    'leadForms.updateLeadForm',
    () => withOrgScope((tx) => updateLeadFormImpl(tx, input), { db }),
    { properties: { id: input.id } }
  );

/**
 * Result type for updateLeadForm
 */
export type UpdateLeadFormResult = Awaited<ReturnType<typeof updateLeadForm>>;
