import {
  type LeadForm,
  leadForm,
  metaAdsIntegration,
  metaAdsPage,
  withOrgScope,
} from '@borradh-workspace/database';
import {
  MetaAdsService,
  decryptCredentials,
  getMetaErrorMessage,
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
  type SyncLeadFormToMetaInput,
  syncLeadFormToMetaSchema,
} from './sync-lead-form-to-meta.schema.js';

/**
 * Internal implementation of sync lead form to Meta
 */
const syncLeadFormToMetaImpl = async (
  db: DbConnection,
  input: SyncLeadFormToMetaInput
): Promise<Result<LeadForm>> => {
  // Validate input
  const parsed = syncLeadFormToMetaSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Get the lead form. `organizationId` (when supplied) scopes the lookup, so
  // an out-of-org id is reported as NOT_FOUND before anything reaches Meta.
  const conditions = [eq(leadForm.id, parsed.data.leadFormId)];
  if (parsed.data.organizationId) {
    conditions.push(eq(leadForm.organizationId, parsed.data.organizationId));
  }

  const form = await db.query.leadForm.findFirst({
    where: and(...conditions),
  });

  if (!form) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Lead form not found', {
        leadFormId: parsed.data.leadFormId,
      })
    );
  }

  // Get the Meta integration for this organization
  const integration = await db.query.metaAdsIntegration.findFirst({
    where: eq(metaAdsIntegration.organizationId, form.organizationId),
  });

  if (!integration || !integration.isActive) {
    // Update form with error status
    await db
      .update(leadForm)
      .set({
        status: 'error',
        syncError: 'Meta Ads integration not configured or inactive',
      })
      .where(eq(leadForm.id, form.id));

    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'Meta Ads integration not configured for this organization'
      )
    );
  }

  // Get the page to sync to (from input, form, or default)
  const pageId =
    parsed.data.metaPageId || form.metaPageId || integration.defaultPageId;

  if (!pageId) {
    await db
      .update(leadForm)
      .set({
        status: 'error',
        syncError: 'No Meta page selected for syncing',
      })
      .where(eq(leadForm.id, form.id));

    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'No Meta page selected for syncing'
      )
    );
  }

  // Get the page details including access token
  const page = await db.query.metaAdsPage.findFirst({
    where: eq(metaAdsPage.id, pageId),
  });

  if (!page || !page.pageAccessToken) {
    await db
      .update(leadForm)
      .set({
        status: 'error',
        syncError: 'Meta page not found or missing access token',
      })
      .where(eq(leadForm.id, form.id));

    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Meta page not found or invalid')
    );
  }

  // Ensure ad account is configured
  if (!integration.adAccountId) {
    await db
      .update(leadForm)
      .set({
        status: 'error',
        syncError: 'Meta Ads integration missing ad account configuration',
      })
      .where(eq(leadForm.id, form.id));

    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Meta Ads integration missing ad account configuration'
      )
    );
  }

  try {
    // Decrypt the page access token
    const credentials = decryptCredentials<{ accessToken: string }>(
      integration.encryptedCredentials
    );

    // Create Meta Ads service
    const metaService = new MetaAdsService({
      accessToken: credentials.accessToken,
      adAccountId: integration.adAccountId,
      pageId: page.pageId,
      appSecret: process.env.META_APP_SECRET || undefined,
    });

    // Build the form config for Meta API
    // Meta requires unique form names per page — append a short timestamp
    // so re-syncing or similarly-named forms never collide.
    const uniqueName = `${form.name} ${Date.now()}`;

    // Map the lead-nurturing follow-up channel to Meta's thank-you-page CTA:
    //   messenger -> P2B_MESSENGER, whatsapp -> WHATSAPP (+ business number).
    // NOTE: this button is opt-IN — the lead has to tap it. It is separate from
    // Meta's "Start conversations on Messenger", which opens a Messenger thread
    // automatically on submit and is what actually reaches every lead. That one
    // is enabled by default for every form in `createLeadGenForm`; do not
    // conflate the two.
    const followUpChannel = form.followUpChannel ?? 'none';
    let nurtureButton:
      | {
          buttonType: 'P2B_MESSENGER' | 'WHATSAPP';
          buttonText?: string;
          businessPhoneNumber?: string;
        }
      | undefined;
    if (followUpChannel === 'messenger') {
      nurtureButton = { buttonType: 'P2B_MESSENGER' };
    } else if (followUpChannel === 'whatsapp' && form.whatsappNumber) {
      nurtureButton = {
        buttonType: 'WHATSAPP',
        businessPhoneNumber: form.whatsappNumber,
      };
    }

    // The thank-you screen is needed when we have copy OR a chat CTA to show.
    const needsThankYouPage =
      !!form.thankYouTitle || !!form.thankYouBody || !!nurtureButton;

    const metaFormConfig = {
      name: uniqueName,
      // Only CUSTOM questions may carry a label (Meta rejects it otherwise).
      questions: form.questions.map((q) => ({
        type: q.type,
        label: q.type === 'CUSTOM' ? q.label : undefined,
        key: q.type === 'CUSTOM' ? q.key : undefined,
        options: q.options,
      })),
      privacyPolicy: {
        url: form.privacyPolicyUrl,
        linkText: form.privacyPolicyLinkText || undefined,
      },
      thankYouPage: needsThankYouPage
        ? {
            title: form.thankYouTitle || undefined,
            body: form.thankYouBody || undefined,
            buttonText:
              form.thankYouButtonText || nurtureButton?.buttonText || undefined,
            buttonUrl: form.thankYouButtonUrl || undefined,
            buttonType: nurtureButton?.buttonType,
            businessPhoneNumber: nurtureButton?.businessPhoneNumber,
          }
        : undefined,
    };

    // Create the form on Meta
    const metaFormId = await metaService.createLeadGenForm(metaFormConfig);

    // Update the form with Meta sync data
    const [updatedForm] = await db
      .update(leadForm)
      .set({
        metaFormId,
        metaPageId: pageId,
        status: 'synced',
        lastSyncAt: new Date(),
        syncError: null,
      })
      .where(eq(leadForm.id, form.id))
      .returning();

    return ok(updatedForm);
  } catch (error) {
    // Prefer Meta's cleaned-up `error_user_msg` for anything the user sees
    // (the persisted `syncError` and the returned message). The FULL technical
    // detail (raw message, code/subcode, fbtrace_id, stack) is preserved in the
    // logError call below, which receives the untouched `error` object.
    const userMessage = getMetaErrorMessage(error);

    logError('leadForms.syncLeadFormToMeta', error, {
      feature: 'lead-forms',
      extra: { leadFormId: form.id, pageId },
    });

    // Update form with error status (user-facing message)
    await db
      .update(leadForm)
      .set({
        status: 'error',
        syncError: userMessage,
      })
      .where(eq(leadForm.id, form.id));

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        `Failed to sync lead form to Meta: ${userMessage}`
      )
    );
  }
};

/**
 * Sync a lead form to Meta
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Sync input with lead form ID
 * @returns Result with updated lead form or error
 *
 * @example
 * ```ts
 * const result = await syncLeadFormToMeta(db, {
 *   leadFormId: 'form_123',
 * });
 * ```
 */
export const syncLeadFormToMeta = (
  db: DbConnection,
  input: SyncLeadFormToMetaInput
) =>
  trackedResult(
    'leadForms.syncLeadFormToMeta',
    () => withOrgScope((tx) => syncLeadFormToMetaImpl(tx, input), { db }),
    { properties: { leadFormId: input.leadFormId } }
  );

/**
 * Result type for syncLeadFormToMeta
 */
export type SyncLeadFormToMetaResult = Awaited<
  ReturnType<typeof syncLeadFormToMeta>
>;
