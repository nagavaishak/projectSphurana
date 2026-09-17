import { whatsappAccount, withOrgScope } from '@borradh-workspace/database';
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
  type ToggleWhatsAppChatbotInput,
  toggleWhatsAppChatbotSchema,
} from './toggle-whatsapp-chatbot.schema.js';

const toggleWhatsAppChatbotImpl = async (
  db: DbConnection,
  input: ToggleWhatsAppChatbotInput
): Promise<Result<{ isChatbotActive: boolean }>> => {
  const parsed = toggleWhatsAppChatbotSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, accountId, enabled } = parsed.data;

  const existing = await db.query.whatsappAccount.findFirst({
    where: and(
      eq(whatsappAccount.id, accountId),
      eq(whatsappAccount.organizationId, organizationId)
    ),
  });

  if (!existing) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'WhatsApp account not found')
    );
  }

  await db
    .update(whatsappAccount)
    .set({ isChatbotActive: enabled })
    .where(eq(whatsappAccount.id, accountId));

  await logAuditEvent(db, {
    action: 'update',
    entityType: 'whatsapp_account',
    entityId: accountId,
    actorType: 'user',
    actorId: null,
    organizationId,
    metadata: {
      field: 'isChatbotActive',
      before: existing.isChatbotActive,
      after: enabled,
    },
  }).catch((error) =>
    logError('integrations.toggleWhatsAppChatbot.audit', error, {
      feature: 'integrations',
      extra: { organizationId, accountId },
    })
  );

  return ok({ isChatbotActive: enabled });
};

export const toggleWhatsAppChatbot = (
  db: DbConnection,
  input: ToggleWhatsAppChatbotInput
) =>
  trackedResult(
    'integrations.toggleWhatsAppChatbot',
    () => withOrgScope((tx) => toggleWhatsAppChatbotImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        accountId: input.accountId,
        enabled: input.enabled,
      },
    }
  );

export type ToggleWhatsAppChatbotResult = Awaited<
  ReturnType<typeof toggleWhatsAppChatbot>
>;
