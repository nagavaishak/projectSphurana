import {
  assistantConversation,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { SKILL_REGISTRY_VERSION } from '../../skills/index.js';
import {
  type FindOrCreateWhatsappConversationInput,
  findOrCreateWhatsappConversationSchema,
} from './find-or-create-whatsapp-conversation.schema.js';

export interface WhatsappConversation {
  id: string;
  loadedSkillIds: string[];
  pendingConfirmation: { kind: string; draftId: string } | null;
  isNew: boolean;
}

/**
 * Find — or, on first contact, create — the single persistent
 * `channel='whatsapp'` assistant conversation for `(userId, organizationId)`.
 *
 * The WhatsApp owner has exactly one long-lived Claire thread (unlike web,
 * where the frontend pre-creates a conversation per chat). The worker (WS-10)
 * calls this on every inbound message so the turn anchors to that thread,
 * carrying its `loadedSkillIds` (skill state) and `pendingConfirmation` gate
 * forward across messages.
 *
 * Stays on the `assistant_conversation` table (NOT the receptionist
 * `conversation` table) — Claire-on-WhatsApp reuses the web-Claire data model.
 */
const findOrCreateWhatsappConversationImpl = async (
  db: DbConnection,
  input: FindOrCreateWhatsappConversationInput
): Promise<Result<WhatsappConversation>> => {
  const parsed = findOrCreateWhatsappConversationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, userId, whatsappPhoneE164 } = parsed.data;

  try {
    return await withOrgScope(
      async (tx) => {
        const [existing] = await tx
          .select({
            id: assistantConversation.id,
            loadedSkillIds: assistantConversation.loadedSkillIds,
            pendingConfirmation: assistantConversation.pendingConfirmation,
          })
          .from(assistantConversation)
          .where(
            and(
              eq(assistantConversation.organizationId, organizationId),
              eq(assistantConversation.userId, userId),
              eq(assistantConversation.channel, 'whatsapp')
            )
          )
          .orderBy(desc(assistantConversation.createdAt))
          .limit(1);

        if (existing) {
          return ok({
            id: existing.id,
            loadedSkillIds: existing.loadedSkillIds ?? [],
            pendingConfirmation: existing.pendingConfirmation ?? null,
            isNew: false,
          });
        }

        const [row] = await tx
          .insert(assistantConversation)
          .values({
            organizationId,
            userId,
            channel: 'whatsapp',
            whatsappPhoneE164,
            // Pin the skill-prompt version at creation (mirrors
            // createConversation) so the thread doesn't freeze on v1.
            skillRegistryVersion: SKILL_REGISTRY_VERSION,
          })
          .returning({
            id: assistantConversation.id,
            loadedSkillIds: assistantConversation.loadedSkillIds,
            pendingConfirmation: assistantConversation.pendingConfirmation,
          });

        return ok({
          id: row.id,
          loadedSkillIds: row.loadedSkillIds ?? [],
          pendingConfirmation: row.pendingConfirmation ?? null,
          isNew: true,
        });
      },
      { db }
    );
  } catch (error) {
    logError('assistant.findOrCreateWhatsappConversation', error, {
      feature: 'assistant',
      extra: { organizationId, userId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to find or create WhatsApp conversation'
      )
    );
  }
};

export const findOrCreateWhatsappConversation = (
  db: DbConnection,
  input: FindOrCreateWhatsappConversationInput
) =>
  trackedResult(
    'assistant.findOrCreateWhatsappConversation',
    () => findOrCreateWhatsappConversationImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );
