import {
  eq,
  metaAdsIntegration,
  withOrgScope,
} from '@borradh-workspace/database';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { getMetaIntegration } from '../get-meta-integration/index.js';
import {
  type ListMetaLeadFormsInput,
  listMetaLeadFormsSchema,
} from './list-meta-lead-forms.schema.js';

const listMetaLeadFormsImpl = async (
  db: DbConnection,
  input: ListMetaLeadFormsInput
): Promise<
  Result<{ forms: Awaited<ReturnType<MetaAdsService['listLeadGenForms']>> }>
> => {
  const parsed = listMetaLeadFormsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

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
    const forms = await metaAdsService.listLeadGenForms();
    return ok({ forms });
  } catch (error) {
    logError('integrations.fetchLeadForms', error, {
      feature: 'integrations',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to fetch lead forms from Meta'
      )
    );
  }
};

export const listMetaLeadForms = (
  db: DbConnection,
  input: ListMetaLeadFormsInput
) =>
  trackedResult(
    'integrations.listMetaLeadForms',
    () => withOrgScope((tx) => listMetaLeadFormsImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );
