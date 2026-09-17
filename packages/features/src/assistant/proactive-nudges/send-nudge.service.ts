import type { WhatsAppCloudService } from '@borradh-workspace/integrations/whatsapp';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../shared/index.js';
import { findOrCreateWhatsappConversation } from '../services/find-or-create-whatsapp-conversation/index.js';
import { saveMessages } from '../services/save-messages/index.js';
import {
  CLAIRE_NUDGE_TEMPLATES,
  CLAIRE_NUDGE_TEMPLATE_LANGUAGE,
  type ClaireNudgeTemplateName,
} from './templates.js';

/**
 * Bridge a proactive nudge into the normal inbound Claire path (WS-11, plan §2
 * P5). Sends the APPROVED WhatsApp template (which opens the 24h window) and
 * records an assistant turn on the owner's whatsapp `assistant_conversation`,
 * so when the owner replies the WS-10 inbound worker picks the thread up and
 * Claire continues free-form.
 *
 * NOTE: the template MUST already be approved by the operator in the Meta UI
 * (plan §0.C). This service does not check approval — it sends; an unapproved
 * template send will fail at Meta and surface as a typed error.
 */

export interface SendClaireNudgeInput {
  organizationId: string;
  userId: string;
  /** Owner's paired E.164 (digits only, no '+'). */
  phoneE164: string;
  template: ClaireNudgeTemplateName;
  /** Ordered template parameters (must match the template's `paramOrder`). */
  params: string[];
}

export interface SendClaireNudgeResult {
  conversationId: string;
  messageId: string;
}

/**
 * Render a human-readable preview of the template body with `{{n}}` filled in,
 * so the recorded assistant turn shows what the owner actually received (the
 * Meta send only carries positional params).
 */
export function renderTemplateBody(
  template: ClaireNudgeTemplateName,
  params: string[]
): string {
  const def = CLAIRE_NUDGE_TEMPLATES[template];
  return def.create.body.replace(/\{\{(\d+)\}\}/g, (_m, n: string) => {
    const idx = Number(n) - 1;
    return params[idx] ?? '';
  });
}

const sendClaireNudgeImpl = async (
  db: DbConnection,
  service: Pick<WhatsAppCloudService, 'sendTemplateMessage'>,
  input: SendClaireNudgeInput
): Promise<Result<SendClaireNudgeResult>> => {
  const { organizationId, userId, phoneE164, template, params } = input;
  const def = CLAIRE_NUDGE_TEMPLATES[template];
  if (!def) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Unknown nudge template')
    );
  }

  // (1) Anchor the owner's persistent whatsapp Claire thread.
  const convResult = await findOrCreateWhatsappConversation(db, {
    organizationId,
    userId,
    whatsappPhoneE164: phoneE164,
  });
  if (!convResult.success) {
    return err(
      new FeatureError(
        convResult.error.code as keyof typeof ErrorCodes,
        convResult.error.message,
        convResult.error.details
      )
    );
  }
  const conversationId = convResult.data.id;

  // (2) Send the approved template — opens the 24h window.
  let messageId: string;
  try {
    const sendResult = await service.sendTemplateMessage({
      to: phoneE164,
      templateName: def.name,
      languageCode: CLAIRE_NUDGE_TEMPLATE_LANGUAGE,
      parameters: Object.fromEntries(
        params.map((value, i) => [String(i), value])
      ),
    });
    messageId = sendResult.messageId;
  } catch (error) {
    logError('assistant.sendClaireNudge', error, {
      feature: 'assistant',
      extra: { organizationId, template, phoneE164 },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to send Claire nudge template'
      )
    );
  }

  // (3) Record the proactive turn so the thread shows Claire spoke first and the
  // owner's reply flows into the WS-10 inbound path. Best-effort — the template
  // already went out; a failed save shouldn't undo the nudge.
  const body = renderTemplateBody(template, params);
  const saved = await saveMessages(db, {
    conversationId,
    organizationId,
    userId,
    userMessageContent: '',
    assistantText: body,
  });
  if (!saved.success) {
    logError(
      'assistant.sendClaireNudge.saveMessages',
      new Error(saved.error.message),
      { feature: 'assistant', extra: { conversationId } }
    );
  }

  return ok({ conversationId, messageId });
};

export const sendClaireNudge = (
  db: DbConnection,
  service: Pick<WhatsAppCloudService, 'sendTemplateMessage'>,
  input: SendClaireNudgeInput
) =>
  trackedResult(
    'assistant.sendClaireNudge',
    () => sendClaireNudgeImpl(db, service, input),
    { properties: { organizationId: input.organizationId } }
  );
