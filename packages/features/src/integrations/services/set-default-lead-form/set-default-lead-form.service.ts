import { metaAdsPage, withOrgScope } from '@borradh-workspace/database';
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
  type SetDefaultLeadFormInput,
  setDefaultLeadFormSchema,
} from './set-default-lead-form.schema.js';

export interface SetDefaultLeadFormResult {
  success: boolean;
  leadFormId: string;
  leadFormName: string | null;
}

/**
 * Internal implementation of set default lead form
 * Updates the default page's lead form (or first page if no default is set)
 */
const setDefaultLeadFormImpl = async (
  db: DbConnection,
  input: SetDefaultLeadFormInput
): Promise<Result<SetDefaultLeadFormResult>> => {
  const parsed = setDefaultLeadFormSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, leadFormId, leadFormName, pageId } = parsed.data;

  try {
    // Check if integration exists
    const integration = await db.query.metaAdsIntegration.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.organizationId, organizationId),
    });

    if (!integration) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          'Meta Ads integration not found. Please connect your Meta account first.'
        )
      );
    }

    // If pageId is provided, use it. Otherwise use the default page or first page.
    let targetPageId = pageId;

    if (!targetPageId) {
      // Try to get the default page, or fall back to first page
      const page = await db.query.metaAdsPage.findFirst({
        where: (t, { eq: eqOp }) =>
          eqOp(t.metaAdsIntegrationId, integration.id),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      });

      if (!page) {
        return err(
          new FeatureError(
            ErrorCodes.NOT_FOUND,
            'No pages found. Please add a page first.'
          )
        );
      }

      targetPageId = page.id;
    }

    // Update the page's default lead form
    await db
      .update(metaAdsPage)
      .set({
        defaultLeadFormId: leadFormId,
        defaultLeadFormName: leadFormName || null,
      })
      .where(
        and(
          eq(metaAdsPage.id, targetPageId),
          eq(metaAdsPage.metaAdsIntegrationId, integration.id)
        )
      );

    return ok({
      success: true,
      leadFormId,
      leadFormName: leadFormName || null,
    });
  } catch (error) {
    logError('integrations.setDefaultLeadForm', error, {
      feature: 'integrations',
      extra: { organizationId, leadFormId },
    });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to set default lead form'
      )
    );
  }
};

/**
 * Set the default lead form for an organization's Meta integration
 */
export const setDefaultLeadForm = (
  db: DbConnection,
  input: SetDefaultLeadFormInput
) =>
  trackedResult(
    'integrations.setDefaultLeadForm',
    () => withOrgScope((tx) => setDefaultLeadFormImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        leadFormId: input.leadFormId,
      },
    }
  );

export type SetDefaultLeadFormServiceResult = Awaited<
  ReturnType<typeof setDefaultLeadForm>
>;
