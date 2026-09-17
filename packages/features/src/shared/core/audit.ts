import {
  type AuditAction,
  type AuditActorType,
  auditLog,
} from '@borradh-workspace/database';
import { logError, trackOrgEvent } from '@borradh-workspace/observability';
import type { DbConnection } from './types.js';

export interface AuditEventInput {
  action: AuditAction;
  entityType: string;
  entityId: string;
  actorType: AuditActorType;
  actorId?: string | null;
  organizationId: string;
  metadata?: Record<string, unknown> | null;
}

export async function logAuditEvent(
  db: DbConnection,
  input: AuditEventInput
): Promise<void> {
  await db.insert(auditLog).values(input);
}

/**
 * Lifecycle events for a single inbound→response cycle on a conversation.
 * These are the decision points where the chatbot pipeline previously went
 * dark — recorded durably so "why didn't this lead get a reply?" is one SQL
 * query against audit_log instead of raw-log archaeology.
 */
export type ConversationEvent =
  | 'conversation_created' // a new conversation was opened
  | 'inbound_received' // a message arrived and was attached to a conversation
  | 'routing_resolved' // page/account + chatbot-active resolved
  | 'bot_suppressed' // bot did NOT run; see metadata.reason
  | 'bot_queued' // chatbot flow job enqueued
  | 'ai_replied' // Claire generated + delivered a reply
  | 'ai_silent_handoff' // Claire chose not to respond, handed to human
  | 'ai_abstained' // empty/abstained result with no explicit handoff
  | 'delivery_failed' // send to Meta/WhatsApp failed; see metadata.error
  | 'escalated' // conversation flipped to agent_handling
  | 'echo_received' // a page-side echo arrived (our send, human, or auto-responder); see metadata
  | 'agent_takeover' // human/page replied directly (echo) → agent_handling
  | 'auto_responder_detected'; // page auto-responder echo; bot kept handling

/**
 * Records a conversation lifecycle event to BOTH:
 *  - audit_log (entity_type='conversation', entity_id=conversationId, indexed)
 *    for durable, per-conversation SQL forensics; and
 *  - PostHog via trackOrgEvent (`conversation.<event>`, grouped by organization)
 *    for analytics — funnels (inbound_received → bot_queued → ai_replied) and
 *    drop-off (bot_suppressed / ai_silent_handoff / delivery_failed) per org.
 *
 * One call feeds both systems so the taxonomy never drifts between them.
 * Fire-and-forget: never throws — tracking must not break message handling.
 */
export async function logConversationEvent(
  db: DbConnection,
  input: {
    organizationId: string;
    conversationId: string;
    event: ConversationEvent;
    /** Defaults to 'update'. Use 'create' for the first-touch event. */
    action?: AuditAction;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  if (!input.conversationId) return;

  // PostHog analytics (funnels/dashboards). Sync + no-op when PostHog isn't
  // initialized, so it's safe to call unconditionally.
  trackOrgEvent(input.organizationId, `conversation.${input.event}`, {
    conversationId: input.conversationId,
    ...(input.metadata ?? {}),
  });

  // Durable SQL trail.
  try {
    await db.insert(auditLog).values({
      action: input.action ?? 'update',
      entityType: 'conversation',
      entityId: input.conversationId,
      actorType: 'system',
      actorId: null,
      organizationId: input.organizationId,
      metadata: { event: input.event, ...(input.metadata ?? {}) },
    });
  } catch (error) {
    logError('conversations.logConversationEvent', error, {
      feature: 'conversations',
      extra: { conversationId: input.conversationId, event: input.event },
    });
  }
}

/**
 * Why a lead-form lead did or did not get Claire's opener.
 *
 * The conversation-level trail above only exists once a conversation does —
 * and the whole point of a SKIPPED first touch is that no conversation was
 * opened. So every skip was previously invisible in SQL: no conversation row,
 * no audit row, nothing on the lead. "Why has this clinic sent nothing?" meant
 * reading application logs, and the PostHog event says `.success` either way
 * because `ok({ sent: false })` is a successful Result.
 *
 * Recorded against the LEAD, so the question is answerable per lead and per
 * org from `audit_log` alone — the same reasoning as `logConversationEvent`,
 * applied to the one decision that happens before a conversation exists.
 *
 * Fire-and-forget: never throws. Losing the trail must not cost the opener.
 */
export async function logFirstTouchOutcome(
  db: DbConnection,
  input: {
    organizationId: string;
    leadId: string;
    /** `null` when nothing was sent. */
    channel: 'whatsapp' | 'sms' | null;
    /** `null` when it WAS sent. */
    reason?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const sent = input.channel !== null;
  trackOrgEvent(
    input.organizationId,
    `lead_first_touch.${sent ? 'sent' : 'skipped'}`,
    {
      leadId: input.leadId,
      channel: input.channel,
      reason: input.reason ?? null,
      ...(input.metadata ?? {}),
    }
  );

  try {
    await db.insert(auditLog).values({
      action: 'update',
      entityType: 'lead',
      entityId: input.leadId,
      actorType: 'system',
      actorId: null,
      organizationId: input.organizationId,
      metadata: {
        event: sent ? 'first_touch_sent' : 'first_touch_skipped',
        channel: input.channel,
        reason: input.reason ?? null,
        ...(input.metadata ?? {}),
      },
    });
  } catch (error) {
    logError('conversations.logFirstTouchOutcome', error, {
      feature: 'conversations',
      extra: { leadId: input.leadId, reason: input.reason },
    });
  }
}
