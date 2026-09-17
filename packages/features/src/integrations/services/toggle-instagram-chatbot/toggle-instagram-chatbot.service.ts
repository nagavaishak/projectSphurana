import {
  instagramIntegration,
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
  logAuditEvent,
  ok,
} from '../../../shared/index.js';
import {
  type ToggleInstagramChatbotInput,
  toggleInstagramChatbotSchema,
} from './toggle-instagram-chatbot.schema.js';

const toggleInstagramChatbotImpl = async (
  db: DbConnection,
  input: ToggleInstagramChatbotInput
): Promise<Result<{ chatbotEnabled: boolean }>> => {
  const parsed = toggleInstagramChatbotSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, enabled } = parsed.data;

  const existing = await db.query.instagramIntegration.findFirst({
    where: and(
      eq(instagramIntegration.organizationId, organizationId),
      eq(instagramIntegration.isActive, true)
    ),
  });

  if (!existing) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Instagram integration not found')
    );
  }

  await db
    .update(instagramIntegration)
    .set({ chatbotEnabled: enabled })
    .where(eq(instagramIntegration.id, existing.id));

  await logAuditEvent(db, {
    action: 'update',
    entityType: 'instagram_integration',
    entityId: existing.id,
    actorType: 'user',
    actorId: null,
    organizationId,
    metadata: {
      field: 'chatbotEnabled',
      before: existing.chatbotEnabled,
      after: enabled,
    },
  }).catch((error) =>
    logError('integrations.toggleInstagramChatbot.audit', error, {
      feature: 'integrations',
      extra: { organizationId },
    })
  );

  return ok({ chatbotEnabled: enabled });
};

export const toggleInstagramChatbot = (
  db: DbConnection,
  input: ToggleInstagramChatbotInput
) =>
  trackedResult(
    'integrations.toggleInstagramChatbot',
    () => withOrgScope((tx) => toggleInstagramChatbotImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        enabled: input.enabled,
      },
    }
  );

export type ToggleInstagramChatbotResult = Awaited<
  ReturnType<typeof toggleInstagramChatbot>
>;
