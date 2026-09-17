import {
  eq,
  metaAdsIntegration,
  withOrgScope,
} from '@borradh-workspace/database';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import {
  MetaAdsService,
  type MetaLeadFormQuestion,
} from '@borradh-workspace/integrations/meta-ads';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { resolveOrgPrivacyPolicyUrl } from '../../../organizations/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { getMetaIntegration } from '../get-meta-integration/index.js';
import { setDefaultLeadForm } from '../set-default-lead-form/index.js';
import {
  type CreateMetaLeadFormInput,
  createMetaLeadFormSchema,
} from './create-meta-lead-form.schema.js';

export interface CreateMetaLeadFormResult {
  formId: string;
  name: string;
}

const createMetaLeadFormImpl = async (
  db: DbConnection,
  input: CreateMetaLeadFormInput
): Promise<Result<CreateMetaLeadFormResult>> => {
  const parsed = createMetaLeadFormSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, name, questions, thankYouPage } = parsed.data;

  // Meta requires a privacy-policy URL on the form. Use the supplied one, else
  // fall back to the org's website / Facebook Page. Only error when nothing
  // usable exists — a missing dedicated policy alone must not block creation.
  const privacyPolicyUrl =
    parsed.data.privacyPolicyUrl?.trim() ||
    (await resolveOrgPrivacyPolicyUrl(db, organizationId));
  if (!privacyPolicyUrl) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'A privacy-policy link is required by Meta, and no website or Facebook Page is set to use instead. Add a website or privacy-policy URL in Settings → Business.'
      )
    );
  }

  // Get the organization's Meta integration
  const integrationResult = await getMetaIntegration(db, { organizationId });
  if (!integrationResult.success) {
    return err(
      new FeatureError(
        integrationResult.error.code,
        integrationResult.error.message
      )
    );
  }

  const integration = integrationResult.data;
  if (!integration) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'Meta Ads integration not found. Please connect your Meta account first.'
      )
    );
  }

  // Query database directly to get encrypted credentials
  const [integrationWithCredentials] = await db
    .select({ encryptedCredentials: metaAdsIntegration.encryptedCredentials })
    .from(metaAdsIntegration)
    .where(eq(metaAdsIntegration.organizationId, organizationId))
    .limit(1);

  if (!integrationWithCredentials?.encryptedCredentials) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Integration credentials not found'
      )
    );
  }

  // Decrypt credentials to get access token
  let accessToken: string;
  try {
    const credentials = decryptCredentials(
      integrationWithCredentials.encryptedCredentials
    ) as { accessToken: string; pageAccessToken?: string };
    accessToken = credentials.pageAccessToken || credentials.accessToken;
  } catch (error) {
    logError('integrations.decryptMeta', error, {
      feature: 'integrations',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to decrypt credentials'
      )
    );
  }

  // Ensure a default page is set
  if (!integration.defaultPage?.pageId) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'No default Facebook page configured. Please set a default page first.'
      )
    );
  }

  // Ensure ad account is configured
  if (!integration.adAccountId) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Meta Ads setup is incomplete. Please complete the setup wizard first.'
      )
    );
  }

  try {
    const metaAdsService = new MetaAdsService({
      accessToken,
      adAccountId: integration.adAccountId,
      pageId: integration.defaultPage.pageId,
      appSecret: process.env.META_APP_SECRET || undefined,
    });

    const formId = await metaAdsService.createLeadGenForm({
      name,
      questions: questions as MetaLeadFormQuestion[],
      privacyPolicy: { url: privacyPolicyUrl },
      thankYouPage,
    });

    // Set as default lead form
    await setDefaultLeadForm(db, {
      organizationId,
      leadFormId: formId,
      leadFormName: name,
    });

    return ok({ formId, name });
  } catch (error) {
    logError('integrations.createLeadForm', error, {
      feature: 'integrations',
      extra: { organizationId },
    });
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to create lead form on Meta';
    return err(new FeatureError(ErrorCodes.INTERNAL_ERROR, message));
  }
};

export const createMetaLeadForm = (
  db: DbConnection,
  input: CreateMetaLeadFormInput
) =>
  trackedResult(
    'integrations.createMetaLeadForm',
    () => withOrgScope((tx) => createMetaLeadFormImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId, name: input.name },
    }
  );
