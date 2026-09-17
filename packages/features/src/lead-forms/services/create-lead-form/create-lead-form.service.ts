import {
  type LeadForm,
  leadForm,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { resolveOrgPrivacyPolicyUrl } from '../../../organizations/index.js';
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
  type CreateLeadFormInput,
  createLeadFormInputSchema,
} from './create-lead-form.schema.js';

/**
 * Internal implementation of create lead form
 */
const createLeadFormImpl = async (
  db: DbConnection,
  input: CreateLeadFormInput
): Promise<Result<LeadForm>> => {
  // Validate input
  const parsed = createLeadFormInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Check if form with same name already exists for this organization
  const existing = await db.query.leadForm.findFirst({
    where: (form, { eq, and }) =>
      and(
        eq(form.organizationId, parsed.data.organizationId),
        eq(form.name, parsed.data.name)
      ),
  });

  if (existing) {
    return err(
      new FeatureError(
        ErrorCodes.ALREADY_EXISTS,
        `Lead form with name "${parsed.data.name}" already exists`,
        { name: parsed.data.name }
      )
    );
  }

  // Meta requires a privacy-policy URL on the form. Use the supplied one, else
  // fall back to the org's website / Facebook Page. Only error when the org has
  // nothing usable — a missing dedicated policy alone must not block creation.
  const privacyPolicyUrl =
    parsed.data.privacyPolicyUrl?.trim() ||
    (await resolveOrgPrivacyPolicyUrl(db, parsed.data.organizationId));
  if (!privacyPolicyUrl) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'A privacy-policy link is required by Meta, and no website or Facebook Page is set to use instead. Add a website or privacy-policy URL in Settings → Business.',
        { organizationId: parsed.data.organizationId }
      )
    );
  }

  // Create lead form
  const [result] = await db
    .insert(leadForm)
    .values({
      organizationId: parsed.data.organizationId,
      name: parsed.data.name,
      questions: parsed.data.questions,
      privacyPolicyUrl,
      privacyPolicyLinkText: parsed.data.privacyPolicyLinkText,
      thankYouTitle: parsed.data.thankYouTitle,
      thankYouBody: parsed.data.thankYouBody,
      thankYouButtonText: parsed.data.thankYouButtonText,
      thankYouButtonUrl: parsed.data.thankYouButtonUrl,
      followUpChannel: parsed.data.followUpChannel,
      whatsappNumber: parsed.data.whatsappNumber,
      metaPageId: parsed.data.metaPageId,
      createdById: parsed.data.createdById,
      status: 'draft',
    })
    .returning();

  // If syncToMeta is true, sync immediately
  if (parsed.data.syncToMeta) {
    const syncResult = await syncLeadFormToMeta(db, { leadFormId: result.id });
    if (syncResult.success) {
      // Return the updated form with Meta sync data
      return ok(syncResult.data);
    }

    // Sync failed (ENG-629 #1). The sync service has already persisted
    // `status: 'error'` + the reason in `syncError` on the row. Returning the
    // stale pre-sync `draft` (`syncError: null`) here would report a clean
    // success and hide the failure from the caller/UI. Re-read the authoritative
    // row so callers see the error state and reason. The form still exists, so
    // this stays an `ok` with an honest body rather than a write failure — the
    // controller returns that row (HTTP 200 with `status: 'error'`), and the
    // assistant lead-forms port re-reads exactly this row to surface the reason.
    const persisted = await db.query.leadForm.findFirst({
      where: (form, { eq }) => eq(form.id, result.id),
    });
    return ok(persisted ?? result);
  }

  return ok(result);
};

/**
 * Create a new lead form
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Lead form creation input
 * @returns Result with created lead form or error
 *
 * @example
 * ```ts
 * const result = await createLeadForm(db, {
 *   organizationId: 'org_123',
 *   name: 'Contact Form',
 *   questions: [
 *     { type: 'EMAIL' },
 *     { type: 'FULL_NAME' },
 *     { type: 'PHONE' },
 *   ],
 *   privacyPolicyUrl: 'https://example.com/privacy',
 *   syncToMeta: true,
 * });
 * ```
 */
export const createLeadForm = (db: DbConnection, input: CreateLeadFormInput) =>
  trackedResult(
    'leadForms.createLeadForm',
    () => withOrgScope((tx) => createLeadFormImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

/**
 * Result type for createLeadForm
 */
export type CreateLeadFormResult = Awaited<ReturnType<typeof createLeadForm>>;
