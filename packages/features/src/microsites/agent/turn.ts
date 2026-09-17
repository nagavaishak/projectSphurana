/**
 * The turn lifecycle: exactly one revision per mutating turn (contract §3).
 *
 * `beginMicrositeTurn` resolves the conversation, records the user's message
 * (so a turn that later fails still leaves a transcript that explains itself)
 * and assembles the model context.
 *
 * `completeMicrositeTurn` re-reads the draft, diffs it against the snapshot
 * taken at the start, and — if and only if something changed — writes ONE
 * revision. One revision per turn is what makes any bad turn a single click to
 * undo; two would make undo ambiguous and none would make it impossible.
 *
 * The revision is written INSIDE A TRANSACTION on purpose. `createRevision`
 * is two statements — insert the snapshot, then move `microsite.draftRevisionId`
 * to it — and only atomic when the caller supplies a `tx`. Split, the failure
 * is not corruption but a stale pointer: the revision exists while the draft
 * still names the previous one, so a later undo silently skips this turn. That
 * surfaces as "my change came back after I hit undo" and is near-impossible to
 * reproduce.
 *
 * The transaction is opened AFTER the model is done, never around the tool
 * loop: holding a pooled connection across model I/O is what saturated the
 * pool in the meta-sync incident.
 */

import type { Database } from '@borradh-workspace/database';
import type { MicrositeToolCall } from '@borradh-workspace/database';
import { logError } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../shared/index.js';
import { createRevision } from '../services/create-revision/create-revision.service.js';
import { toFeatureError } from '../services/shared/errors.js';
import {
  type MicrositeTurnContext,
  buildMicrositeTurnContext,
} from './build-turn-context.js';
import { appendMessage, resolveConversation } from './conversation.js';
import {
  EMPTY_MICROSITE_DIFF,
  type MicrositeTurnDiff,
  computeMicrositeDiff,
  describeDiff,
  isEmptyDiff,
} from './diff.js';
import { loadDraft } from './draft-writer.js';
import type { MicrositeAgentSession } from './types.js';

export interface BeganMicrositeTurn extends MicrositeTurnContext {
  conversationId: string;
  /** The stored user message. Carried onto the revision as `promptId`. */
  promptId: string;
}

export const beginMicrositeTurn = async (
  db: DbConnection,
  input: {
    session: MicrositeAgentSession;
    conversationId?: string;
    message: string;
    selectedBlockId?: string;
    historyTurns?: number;
  }
): Promise<Result<BeganMicrositeTurn>> => {
  const message = input.message.trim();
  if (!message) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Message is required')
    );
  }

  const conversation = await resolveConversation(
    db,
    input.session,
    input.conversationId
  );
  if (!conversation.success) return err(conversation.error);

  // Context is assembled BEFORE the user's message is stored, so the history
  // the model sees is the history, not a duplicate of the message it is
  // already being handed.
  const context = await buildMicrositeTurnContext(db, {
    session: input.session,
    conversationId: conversation.data.id,
    historyTurns: input.historyTurns,
    selectedBlockId: input.selectedBlockId,
  });
  if (!context.success) return err(context.error);

  const stored = await appendMessage(db, input.session, {
    conversationId: conversation.data.id,
    role: 'user',
    content: message,
  });
  if (!stored.success) return err(stored.error);

  return ok({
    ...context.data,
    conversationId: conversation.data.id,
    promptId: stored.data.id,
  });
};

export interface CompletedMicrositeTurn {
  /** Null when the turn changed nothing — no revision is written for those. */
  revisionId: string | null;
  diff: MicrositeTurnDiff;
  messageId: string;
}

export const completeMicrositeTurn = async (
  db: DbConnection,
  input: {
    session: MicrositeAgentSession;
    turn: BeganMicrositeTurn;
    assistantText: string;
    toolCalls: MicrositeToolCall[];
  }
): Promise<Result<CompletedMicrositeTurn>> => {
  const after = await loadDraft(db, input.session);
  if (!after.success) return err(after.error);

  const diff = computeMicrositeDiff(input.turn.draftBefore, after.data);

  let revisionId: string | null = null;
  if (!isEmptyDiff(diff)) {
    try {
      const revision = await (db as Database).transaction((tx) =>
        createRevision(tx, {
          micrositeId: input.session.micrositeId,
          organizationId: input.session.organizationId,
          createdBy: 'agent',
          label: describeDiff(diff),
          promptId: input.turn.promptId,
        })
      );
      if (!revision.success) return err(toFeatureError(revision.error));
      revisionId = revision.data.id;
    } catch (error) {
      logError('microsites.agent.completeTurn', error, {
        feature: 'microsites',
        extra: {
          micrositeId: input.session.micrositeId,
          organizationId: input.session.organizationId,
        },
      });
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'The website was edited but the version could not be saved'
        )
      );
    }
  }

  const stored = await appendMessage(db, input.session, {
    conversationId: input.turn.conversationId,
    role: 'assistant',
    content: input.assistantText,
    toolCalls: input.toolCalls,
    revisionId,
  });
  if (!stored.success) return err(stored.error);

  return ok({ revisionId, diff, messageId: stored.data.id });
};

/** The diff shape a turn that failed before touching anything reports. */
export const noChangeDiff = (): MicrositeTurnDiff => ({
  ...EMPTY_MICROSITE_DIFF,
  added: [],
  edited: [],
  removed: [],
});
