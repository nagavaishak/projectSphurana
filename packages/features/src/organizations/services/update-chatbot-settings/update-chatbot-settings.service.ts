import { organization, withOrgScope } from '@borradh-workspace/database';
import type { ChatbotSettings } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  logAuditEvent,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type UpdateChatbotSettingsInput,
  updateChatbotSettingsSchema,
} from './update-chatbot-settings.schema.js';

export interface UpdateChatbotSettingsResponse {
  id: string;
  chatbotSettings: ChatbotSettings | null;
  chatbotSystemPrompt: string | null;
  knowledgeBase: unknown;
}

const updateChatbotSettingsImpl = async (
  db: DbConnection,
  input: UpdateChatbotSettingsInput
): Promise<Result<UpdateChatbotSettingsResponse>> => {
  const parsed = updateChatbotSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, ...updateData } = parsed.data;

  if (Object.keys(updateData).length === 0) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'No fields to update')
    );
  }

  try {
    const existing = await db.query.organization.findFirst({
      where: and(eq(organization.id, organizationId), notDeleted(organization)),
      columns: { id: true },
    });

    if (!existing) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
      );
    }

    const updateValues: Partial<typeof organization.$inferInsert> = {};

    if (updateData.chatbotSettings !== undefined) {
      updateValues.chatbotSettings =
        updateData.chatbotSettings as ChatbotSettings;
    }
    if (updateData.chatbotSystemPrompt !== undefined) {
      updateValues.chatbotSystemPrompt = updateData.chatbotSystemPrompt;
    }
    if (updateData.knowledgeBase !== undefined) {
      updateValues.knowledgeBase = updateData.knowledgeBase;
    }

    const [updated] = await db
      .update(organization)
      .set(updateValues)
      .where(and(eq(organization.id, organizationId), notDeleted(organization)))
      .returning({
        id: organization.id,
        chatbotSettings: organization.chatbotSettings,
        chatbotSystemPrompt: organization.chatbotSystemPrompt,
        knowledgeBase: organization.knowledgeBase,
      });

    if (!updated) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
      );
    }

    // Audit: chatbot settings (system prompt, knowledge base, etc.) directly
    // change who Claire engages — track every change.
    await logAuditEvent(db, {
      action: 'update',
      entityType: 'organization',
      entityId: organizationId,
      actorType: 'user',
      actorId: null,
      organizationId,
      metadata: {
        field: 'chatbotSettings',
        changedFields: Object.keys(updateData),
        systemPromptChanged: updateData.chatbotSystemPrompt !== undefined,
        knowledgeBaseChanged: updateData.knowledgeBase !== undefined,
      },
    }).catch((auditError) =>
      logError('organizations.updateChatbotSettings.audit', auditError, {
        feature: 'organizations',
        extra: { organizationId },
      })
    );

    return ok(updated);
  } catch (error) {
    logError('organizations.updateChatbotSettings', error, {
      feature: 'organizations',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update chatbot settings'
      )
    );
  }
};

export const updateChatbotSettings = (
  db: DbConnection,
  input: UpdateChatbotSettingsInput
) =>
  trackedResult(
    'organizations.updateChatbotSettings',
    () => withOrgScope((tx) => updateChatbotSettingsImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type UpdateChatbotSettingsResult = Awaited<
  ReturnType<typeof updateChatbotSettings>
>;
