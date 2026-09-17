import { metaAdsPage, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  logAuditEvent,
  ok,
} from '../../../shared/index.js';
import {
  type TogglePageChatbotInput,
  togglePageChatbotSchema,
} from './toggle-page-chatbot.schema.js';

const togglePageChatbotImpl = async (
  db: DbConnection,
  input: TogglePageChatbotInput
): Promise<Result<{ isChatbotActive: boolean }>> => {
  const parsed = togglePageChatbotSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, pageId, enabled } = parsed.data;

  // Verify page belongs to the organization via integration
  const existing = await db.query.metaAdsPage.findFirst({
    where: eq(metaAdsPage.id, pageId),
    with: {
      integration: {
        columns: { organizationId: true },
      },
    },
  });

  if (!existing || existing.integration.organizationId !== organizationId) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Page not found'));
  }

  await db
    .update(metaAdsPage)
    .set({ isChatbotActive: enabled })
    .where(eq(metaAdsPage.id, pageId));

  // Audit: turning the page chatbot on/off directly controls whether Claire
  // responds at all — record who changed it and when.
  await logAuditEvent(db, {
    action: 'update',
    entityType: 'meta_ads_page',
    entityId: pageId,
    actorType: 'user',
    actorId: null,
    organizationId,
    metadata: {
      field: 'isChatbotActive',
      before: existing.isChatbotActive,
      after: enabled,
    },
  }).catch((error) =>
    logError('integrations.togglePageChatbot.audit', error, {
      feature: 'integrations',
      extra: { organizationId, pageId },
    })
  );

  return ok({ isChatbotActive: enabled });
};

export const togglePageChatbot = (
  db: DbConnection,
  input: TogglePageChatbotInput
) =>
  trackedResult(
    'integrations.togglePageChatbot',
    () => withOrgScope((tx) => togglePageChatbotImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        pageId: input.pageId,
        enabled: input.enabled,
      },
    }
  );

export type TogglePageChatbotResult = Awaited<
  ReturnType<typeof togglePageChatbot>
>;
