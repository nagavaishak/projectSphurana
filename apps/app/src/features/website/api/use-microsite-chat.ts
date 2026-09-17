'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';

import { getAuthToken } from '@/lib/auth-token';
import { resolveApiUrl } from '@/lib/resolve-api-url';

import {
  consumeMicrositeStream,
  isDestructiveTool,
  toolSummary,
} from './microsite-stream';
import type {
  BlockSelection,
  MicrositeStreamErrorCode,
  TranscriptEntry,
} from './types';
import { micrositeQueryKey } from './use-microsite';
import { revisionsQueryKey } from './use-revisions';

let entrySeq = 0;
const nextId = (prefix: string) => `${prefix}-${++entrySeq}`;

export interface SendTurnOptions {
  /**
   * The block the canvas has selected. Scoping the turn is what makes "make
   * this shorter" mean something precise — without it the model has to guess
   * which section "this" is, and it guesses wrong on any page with two of them.
   */
  selection?: BlockSelection | null;
  /**
   * Destructive actions the user has explicitly approved (`delete_page`, a
   * `brand` theme patch). The API refuses to run them without this, and no tool
   * schema exposes the field, so the model cannot approve itself.
   */
  confirmedActions?: string[];
  /**
   * A confirmation re-send replays a prompt the transcript already shows, so it
   * does not append a second user bubble.
   */
  echoPrompt?: boolean;
}

interface UseMicrositeChatArgs {
  micrositeId: string | null;
  /** The draft revision BEFORE a turn — what that turn's Undo restores. */
  draftRevisionId: string | null;
  conversationId: string | null;
  onConversationId: (id: string) => void;
}

/**
 * The editor's turn loop: POST `microsites/:id/chat`, consume the SSE stream
 * (§4), and fold its events into the transcript.
 *
 * Bearer, not just the cookie — `AuthGuard` falls back to a `__Secure-` cookie
 * that never reaches an SSE call from the SPA and does not exist at all under
 * Capacitor, so the request would 401 before a single token arrived. Same
 * reasoning (and the same token) as the campaign drafting stream.
 */
export function useMicrositeChat({
  micrositeId,
  draftRevisionId,
  conversationId,
  onConversationId,
}: UseMicrositeChatArgs) {
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  /** Turns whose blocking confirmation has already been answered. */
  const answeredConfirmations = useRef<Set<string>>(new Set());

  const patchEntry = useCallback(
    (id: string, changes: (entry: TranscriptEntry) => TranscriptEntry) => {
      setEntries((current) =>
        current.map((entry) => (entry.id === id ? changes(entry) : entry))
      );
    },
    []
  );

  const markDecision = useCallback(
    (entryId: string, decision: 'kept' | 'undone') => {
      patchEntry(entryId, (entry) => ({ ...entry, decision }));
    },
    [patchEntry]
  );

  /** Seed the transcript from a stored conversation (`GET .../conversations/:cid`). */
  const setInitialEntries = useCallback((initial: TranscriptEntry[]) => {
    setEntries(initial);
  }, []);

  const sendTurn = useCallback(
    async (prompt: string, options?: SendTurnOptions) => {
      const trimmed = prompt.trim();
      if (!trimmed || !micrositeId || isStreaming) return;

      const userEntryId = nextId('user');
      const assistantEntryId = nextId('assistant');
      const previousRevisionId = draftRevisionId;

      const echoPrompt = options?.echoPrompt !== false;
      const selection = options?.selection ?? null;
      const confirmedActions = options?.confirmedActions ?? [];

      setEntries((current) => [
        ...current,
        ...(echoPrompt
          ? [
              {
                id: userEntryId,
                role: 'user' as const,
                text: trimmed,
                activities: [],
                status: 'complete' as const,
              },
            ]
          : []),
        {
          id: assistantEntryId,
          role: 'assistant',
          text: '',
          activities: [],
          status: 'streaming',
          previousRevisionId,
          prompt: trimmed,
          selection,
        },
      ]);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const fail = (message: string, code?: MicrositeStreamErrorCode) => {
        patchEntry(assistantEntryId, (entry) => ({
          ...entry,
          status: code && code !== 'internal' ? 'refused' : 'error',
          error: { message, code },
        }));
      };

      try {
        const token = getAuthToken();
        const response = await fetch(
          resolveApiUrl(`microsites/${micrositeId}/chat`),
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            credentials: 'include',
            signal: controller.signal,
            body: JSON.stringify({
              prompt: trimmed,
              conversationId: conversationId ?? undefined,
              // Block scope for "make this shorter". §4 does not pin the
              // request body down; this mirrors the tools' own addressing
              // (`path`/`blockId`) so the API can map it straight through.
              selection: selection ?? undefined,
              // Blocking confirmations (contract amendment): a destructive tool
              // runs only when its action key is echoed back here.
              confirmedActions,
            }),
          }
        );

        if (!response.ok || !response.body) {
          fail(
            response.status === 429
              ? 'You have hit the editing limit for now. Try again shortly.'
              : `The editor could not reach the assistant (${response.status}).`,
            response.status === 429 ? 'spend_cap' : 'internal'
          );
          return;
        }

        await consumeMicrositeStream(
          response.body,
          (event) => {
            if (event.type === 'text') {
              patchEntry(assistantEntryId, (entry) => ({
                ...entry,
                text: entry.text + event.delta,
              }));
              return;
            }

            if (event.type === 'tool') {
              const confirmation = event.confirmation;
              patchEntry(assistantEntryId, (entry) => ({
                ...entry,
                activities: [
                  ...entry.activities,
                  {
                    id: nextId('tool'),
                    name: event.name,
                    summary: toolSummary(event.name, event.summary),
                    error: event.error,
                    requiresConfirmation:
                      event.requiresConfirmation === true ||
                      isDestructiveTool(event.name),
                    confirmation,
                  },
                ],
                // A blocked tool did NOT run. The turn is not done, and the
                // sidebar has to say so — a turn that just stops looks exactly
                // like a model that ignored the request.
                pendingConfirmations: confirmation
                  ? [...(entry.pendingConfirmations ?? []), confirmation]
                  : entry.pendingConfirmations,
                confirmationState: confirmation
                  ? 'awaiting'
                  : entry.confirmationState,
              }));
              return;
            }

            if (event.type === 'done') {
              if (
                event.conversationId &&
                event.conversationId !== conversationId
              ) {
                onConversationId(event.conversationId);
              }
              patchEntry(assistantEntryId, (entry) => ({
                ...entry,
                status: 'complete',
                diff: event.diff,
                revisionId: event.revisionId,
              }));
              // The turn wrote a revision and rewrote the draft.
              void queryClient.invalidateQueries({
                queryKey: micrositeQueryKey,
              });
              void queryClient.invalidateQueries({
                queryKey: revisionsQueryKey(micrositeId),
              });
              return;
            }

            fail(event.message, event.code);
          },
          controller.signal
        );

        // The stream ended without a `done` and without an `error` — treat it
        // as a failure rather than leaving a spinner running forever.
        patchEntry(assistantEntryId, (entry) =>
          entry.status === 'streaming' &&
          (entry.pendingConfirmations?.length ?? 0) > 0
            ? // Not a dropped connection: the turn stopped ON PURPOSE, waiting
              // for the user to approve a destructive action.
              { ...entry, status: 'complete' as const }
            : entry.status === 'streaming'
              ? {
                  ...entry,
                  status: 'error',
                  error: {
                    message: 'The connection dropped before the turn finished.',
                  },
                }
              : entry
        );
      } catch (error) {
        if (controller.signal.aborted) {
          patchEntry(assistantEntryId, (entry) => ({
            ...entry,
            status: 'error',
            error: { message: 'Stopped.' },
          }));
        } else {
          fail(
            error instanceof Error
              ? error.message
              : 'The editor lost its connection.'
          );
        }
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [
      conversationId,
      draftRevisionId,
      isStreaming,
      micrositeId,
      onConversationId,
      patchEntry,
      queryClient,
    ]
  );

  /**
   * The user approved a blocked destructive action: re-send the SAME prompt
   * with its action key in `confirmedActions`, which is the only way the API
   * will run it. The original turn is marked confirmed so its card stops asking.
   */
  const confirmTurn = useCallback(
    async (entry: TranscriptEntry) => {
      const pending = entry.pendingConfirmations ?? [];
      const prompt = entry.prompt;
      if (pending.length === 0 || !prompt) return;
      // The caller may hold a stale copy of the entry (React state is a
      // snapshot). Answering the same confirmation twice would run a
      // destructive action twice, so the guard lives in a ref, not in props.
      if (answeredConfirmations.current.has(entry.id)) return;
      answeredConfirmations.current.add(entry.id);

      patchEntry(entry.id, (current) => ({
        ...current,
        confirmationState: 'confirmed',
      }));

      await sendTurn(prompt, {
        selection: entry.selection ?? null,
        confirmedActions: pending.map((item) => item.action),
        echoPrompt: false,
      });
    },
    [patchEntry, sendTurn]
  );

  /** The user declined. Nothing is sent, and the turn stays visibly not-done. */
  const declineConfirmation = useCallback(
    (entryId: string) => {
      answeredConfirmations.current.add(entryId);
      patchEntry(entryId, (entry) => ({
        ...entry,
        confirmationState: 'declined',
      }));
    },
    [patchEntry]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    entries,
    isStreaming,
    sendTurn,
    confirmTurn,
    declineConfirmation,
    stop,
    markDecision,
    setInitialEntries,
  };
}
