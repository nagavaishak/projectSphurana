import {
  assistantConversation,
  assistantMessage,
  withOrgScope,
} from '@borradh-workspace/database';
import { fetchWithRetry, fetchWithTimeout } from '@borradh-workspace/http';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, asc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { escalateConversation } from '../escalate-conversation/escalate-conversation.service.js';
import {
  type RequestClaireHandoffInput,
  requestClaireHandoffSchema,
} from './request-claire-handoff.schema.js';

const INTERCOM_BASE_URL = 'https://api.intercom.io';
const INTERCOM_CONVERSATIONS_URL = `${INTERCOM_BASE_URL}/conversations`;
const INTERCOM_CONTACTS_URL = `${INTERCOM_BASE_URL}/contacts`;
const INTERCOM_CONTACTS_SEARCH_URL = `${INTERCOM_BASE_URL}/contacts/search`;
const INTERCOM_VERSION = '2.11';

function intercomHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    // Intercom requires a version header for stability across dashboard
    // changes. 2.11 is the current default in their docs.
    'Intercom-Version': INTERCOM_VERSION,
  };
}

interface IntercomContact {
  id?: string;
}

interface IntercomContactSearchResponse {
  data?: IntercomContact[];
}

/**
 * Find the Intercom contact whose `external_id` matches our user id.
 * Returns the Intercom contact id, or null if none exists yet.
 */
async function findIntercomContact(
  accessToken: string,
  userId: string
): Promise<string | null> {
  const response = await fetchWithRetry(INTERCOM_CONTACTS_SEARCH_URL, {
    method: 'POST',
    headers: intercomHeaders(accessToken),
    body: JSON.stringify({
      query: { field: 'external_id', operator: '=', value: userId },
    }),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as IntercomContactSearchResponse;
  return payload.data?.[0]?.id ?? null;
}

/**
 * Get-or-create the Intercom contact for this user and return its Intercom
 * contact id.
 *
 * The conversations API rejects `from.user_id` values it doesn't recognise
 * with "User Not Found" (ENG-382). That happens when a user triggers a
 * server-side handoff before ever opening the Intercom messenger (which is
 * what would otherwise create the contact). We resolve it by ensuring the
 * contact exists first, then opening the conversation against the contact's
 * internal Intercom id.
 */
async function ensureIntercomContact(
  accessToken: string,
  user: { userId: string; email?: string; name?: string }
): Promise<string | null> {
  // Search first — the messenger may have already created the contact.
  const existing = await findIntercomContact(accessToken, user.userId);
  if (existing) return existing;

  const response = await fetchWithTimeout(INTERCOM_CONTACTS_URL, {
    method: 'POST',
    headers: intercomHeaders(accessToken),
    body: JSON.stringify({
      role: 'user',
      external_id: user.userId,
      ...(user.email ? { email: user.email } : {}),
      ...(user.name ? { name: user.name } : {}),
    }),
  });

  if (response.ok) {
    const payload = (await response.json()) as IntercomContact;
    return payload.id ?? null;
  }

  // 409 = a matching contact already exists (race, or matched on email).
  // Re-search to pick up its id rather than failing the handoff.
  if (response.status === 409) {
    return findIntercomContact(accessToken, user.userId);
  }

  // Surface the body for diagnostics; caller decides how to proceed.
  const errBody = await response.text();
  throw new Error(
    `Intercom create contact failed (${response.status}): ${errBody}`
  );
}

export interface RequestClaireHandoffResult {
  conversationId: string;
  intercomConversationId: string | null;
  /** True when this call created a new Intercom conversation. False when the
   *  Claire conversation was already escalated (idempotent re-click). */
  created: boolean;
  /** Why no Intercom conversation was created — null on success. */
  reason?: string;
}

interface IntercomCreateConversationResponse {
  id?: string;
  conversation_id?: string;
}

const requestClaireHandoffImpl = async (
  db: DbConnection,
  input: RequestClaireHandoffInput,
  config: { accessToken?: string }
): Promise<Result<RequestClaireHandoffResult>> => {
  const parsed = requestClaireHandoffSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    conversationId,
    organizationId,
    userId,
    userEmail,
    userName,
    reason,
    transcriptMaxMessages,
  } = parsed.data;

  // Load conversation first to enforce org/user scoping and short-circuit
  // if we've already handed off to support.
  const existing = await withOrgScope(
    (tx) =>
      tx.query.assistantConversation.findFirst({
        where: and(
          eq(assistantConversation.id, conversationId),
          eq(assistantConversation.organizationId, organizationId),
          eq(assistantConversation.userId, userId),
          notDeleted(assistantConversation)
        ),
      }),
    { db }
  );

  if (!existing) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found')
    );
  }

  if (existing.status === 'escalated' && existing.intercomConversationId) {
    // Idempotent: already handed off, return the existing Intercom id so the
    // UI can reopen the same chat instead of creating a duplicate.
    return ok({
      conversationId,
      intercomConversationId: existing.intercomConversationId,
      created: false,
    });
  }

  if (!config.accessToken) {
    return ok({
      conversationId,
      intercomConversationId: null,
      created: false,
      reason: 'intercom_not_configured',
    });
  }

  // Load recent messages for the transcript seed. Oldest-first so the
  // Intercom body reads as a chronological exchange.
  // assistant_message is Bucket B (child-of-org); scoped implicitly via
  // the conversationId FK. Wrap under org scope anyway to stay consistent.
  const recentMessages = await withOrgScope(
    (tx) =>
      tx
        .select({
          role: assistantMessage.role,
          content: assistantMessage.content,
          toolCalls: assistantMessage.toolCalls,
          createdAt: assistantMessage.createdAt,
        })
        .from(assistantMessage)
        .where(eq(assistantMessage.conversationId, conversationId))
        .orderBy(asc(assistantMessage.createdAt))
        .limit(transcriptMaxMessages),
    { db }
  );

  const transcript = formatTranscript(recentMessages);
  const body = buildIntercomBody(reason, transcript);

  let intercomId: string;
  try {
    // Ensure the Intercom contact exists first so the conversation can be
    // opened against its internal id, avoiding "User Not Found" for users
    // who never opened the messenger (ENG-382). If we can't resolve a
    // contact id we fall back to the legacy external-id reference.
    let contactId: string | null = null;
    try {
      contactId = await ensureIntercomContact(config.accessToken, {
        userId,
        email: userEmail,
        name: userName,
      });
    } catch (contactError) {
      logError('assistant.requestClaireHandoff.ensureContact', contactError, {
        feature: 'assistant',
        extra: { conversationId, organizationId, userId },
      });
    }

    const from = contactId
      ? { type: 'user', id: contactId }
      : { type: 'user', user_id: userId };

    const response = await fetchWithTimeout(INTERCOM_CONVERSATIONS_URL, {
      method: 'POST',
      headers: intercomHeaders(config.accessToken),
      body: JSON.stringify({
        from,
        body,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      logError(
        'assistant.requestClaireHandoff',
        new Error(`Intercom create conversation failed: ${errBody}`),
        {
          feature: 'assistant',
          extra: {
            conversationId,
            organizationId,
            userId,
            status: response.status,
          },
        }
      );
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Could not open a support chat right now. Try again in a moment.'
        )
      );
    }

    const payload =
      (await response.json()) as IntercomCreateConversationResponse;
    intercomId = payload.id ?? payload.conversation_id ?? '';
    if (!intercomId) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Intercom returned no conversation id'
        )
      );
    }
  } catch (error) {
    logError('assistant.requestClaireHandoff', error, {
      feature: 'assistant',
      extra: { conversationId, organizationId, userId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Could not open a support chat right now. Try again in a moment.'
      )
    );
  }

  // Flip status + persist the linked Intercom conversation id. Reuses the
  // existing escalate service so callers picking up `assistantConversation`
  // observe the same status transition (status='escalated', escalatedAt set).
  const escalateResult = await escalateConversation(db, {
    conversationId,
    organizationId,
    userId,
    reason,
    intercomConversationId: intercomId,
  });

  if (!escalateResult.success) {
    // Intercom side succeeded but we couldn't persist the link. Surface a
    // generic error — the user can retry, and the idempotent guard above
    // will return the existing Intercom id if escalation eventually lands.
    return err(
      new FeatureError(
        escalateResult.error.code,
        escalateResult.error.message,
        escalateResult.error.details
      )
    );
  }

  return ok({
    conversationId,
    intercomConversationId: intercomId,
    created: true,
  });
};

export const requestClaireHandoff = (
  db: DbConnection,
  input: RequestClaireHandoffInput,
  config: { accessToken?: string }
) =>
  trackedResult(
    'assistant.requestClaireHandoff',
    () => requestClaireHandoffImpl(db, input, config),
    {
      properties: {
        conversationId: input.conversationId,
        organizationId: input.organizationId,
      },
    }
  );

export type RequestClaireHandoffServiceResult = Awaited<
  ReturnType<typeof requestClaireHandoff>
>;

// ────────────────────────────────────────────────────────────────────────
// Formatting helpers

interface TranscriptMessage {
  role: string;
  content: string | null;
  toolCalls: unknown;
}

function formatTranscript(messages: TranscriptMessage[]): string {
  if (messages.length === 0) {
    return '(No prior conversation.)';
  }

  const lines: string[] = [];
  for (const message of messages) {
    const speaker =
      message.role === 'user'
        ? 'Owner'
        : message.role === 'assistant'
          ? 'Claire'
          : message.role === 'tool'
            ? 'Tool'
            : message.role === 'system'
              ? 'System'
              : message.role;

    const text = (message.content ?? '').trim();
    if (text) {
      lines.push(`${speaker}: ${text}`);
    }

    // Surface tool calls as 1-line summaries so agents see what Claire did,
    // without dumping raw JSON payloads into the support thread.
    if (Array.isArray(message.toolCalls)) {
      for (const call of message.toolCalls) {
        if (call && typeof call === 'object' && 'toolName' in call) {
          const toolName = String(
            (call as { toolName?: unknown }).toolName ?? 'tool'
          );
          lines.push(`Claire used: ${toolName}`);
        }
      }
    }
  }

  return lines.join('\n');
}

function buildIntercomBody(reason: string, transcript: string): string {
  // Plain-text body. Intercom renders newlines as line breaks in admin
  // inbox view, which is what we want for a transcript dump.
  return [
    `**Reason:** ${reason}`,
    '',
    '**Recent conversation with Claire:**',
    transcript,
  ].join('\n');
}
