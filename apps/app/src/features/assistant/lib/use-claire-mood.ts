import type { UIMessage } from 'ai';
import { useEffect, useMemo, useRef, useState } from 'react';

import { CONFIRMATION_TOOLS, asToolPart, getToolName } from './tool-parts';

export type ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error';
export type ClaireMood = 'calm' | 'excited' | 'thinking' | 'celebrating';

const CELEBRATE_DURATION_MS = 1500;

export interface DeriveBaseMoodInput {
  status: ChatStatus;
  hasPendingConfirmation: boolean;
  hasReasoningStreaming: boolean;
  hasToolCallRunning: boolean;
}

/**
 * Pure derivation of the non-transient mood from current chat state.
 * `celebrating` is a transient overlay handled by the hook and never returned here.
 */
export function deriveBaseMood({
  status,
  hasPendingConfirmation,
  hasReasoningStreaming,
  hasToolCallRunning,
}: DeriveBaseMoodInput): ClaireMood {
  if (status === 'submitted') return 'thinking';
  if (status === 'streaming') {
    if (hasPendingConfirmation) return 'excited';
    if (hasToolCallRunning || hasReasoningStreaming) return 'thinking';
    return 'calm';
  }
  // 'ready' and 'error' both fall back to calm.
  return 'calm';
}

interface AssistantMessageSignals {
  hasPendingConfirmation: boolean;
  hasReasoningStreaming: boolean;
  hasToolCallRunning: boolean;
  hasJustConfirmedDestructive: boolean;
}

const EMPTY_SIGNALS: AssistantMessageSignals = {
  hasPendingConfirmation: false,
  hasReasoningStreaming: false,
  hasToolCallRunning: false,
  hasJustConfirmedDestructive: false,
};

/**
 * Walks the latest assistant message's parts and extracts the signals
 * needed for mood derivation. Pure; exported for testability.
 */
export function analyzeAssistantSignals(
  message: UIMessage | undefined
): AssistantMessageSignals {
  if (!message || message.role !== 'assistant') return EMPTY_SIGNALS;

  let hasPendingConfirmation = false;
  let hasToolCallRunning = false;
  let hasReasoningStreaming = false;
  let hasJustConfirmedDestructive = false;

  for (const part of message.parts) {
    if (part.type === 'reasoning') {
      const state = (part as unknown as { state?: string }).state;
      if (state === 'streaming') hasReasoningStreaming = true;
      continue;
    }

    const tp = asToolPart(part);
    if (!tp) continue;

    const toolName = getToolName(tp);
    const isConfirmation = CONFIRMATION_TOOLS.has(toolName);
    const isComplete = tp.state === 'output-available';
    const isErrored = tp.state === 'output-error';

    if (isConfirmation) {
      if (isComplete) {
        // Output is a string ('approved' | 'rejected') under the runtime shape.
        if ((tp.output as unknown as string) === 'approved') {
          hasJustConfirmedDestructive = true;
        }
      } else {
        hasPendingConfirmation = true;
      }
    }

    if (!isComplete && !isErrored) {
      hasToolCallRunning = true;
    }
  }

  return {
    hasPendingConfirmation,
    hasReasoningStreaming,
    hasToolCallRunning,
    hasJustConfirmedDestructive,
  };
}

export interface UseClaireMoodOptions {
  status: ChatStatus;
  messages: UIMessage[];
}

/**
 * Drive Claire's avatar mood from the active chat state. State machine
 * documented in `docs/implementations/claire-briefs/track-c01.md` §Step 4.
 *
 * Locked decisions:
 * - 'celebrating' fires only on a confirmed-destructive turn finishing cleanly,
 *   then auto-decays to 'calm' after 1.5s. We never celebrate on plain chitchat.
 * - 'excited' fires while a confirmation card is awaiting the operator's click.
 */
export function useClaireMood({
  status,
  messages,
}: UseClaireMoodOptions): ClaireMood {
  const lastMessage = messages[messages.length - 1];

  const signals = useMemo(
    () => analyzeAssistantSignals(lastMessage),
    [lastMessage]
  );

  const prevStatusRef = useRef<ChatStatus>(status);
  const [isCelebrating, setIsCelebrating] = useState(false);
  const celebrateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;

    const transitionedToReady = prev !== 'ready' && status === 'ready';
    if (!transitionedToReady) return;
    if (!signals.hasJustConfirmedDestructive) return;

    if (celebrateTimerRef.current !== null) {
      clearTimeout(celebrateTimerRef.current);
    }
    setIsCelebrating(true);
    celebrateTimerRef.current = setTimeout(() => {
      setIsCelebrating(false);
      celebrateTimerRef.current = null;
    }, CELEBRATE_DURATION_MS);
  }, [status, signals.hasJustConfirmedDestructive]);

  useEffect(
    () => () => {
      if (celebrateTimerRef.current !== null) {
        clearTimeout(celebrateTimerRef.current);
        celebrateTimerRef.current = null;
      }
    },
    []
  );

  if (isCelebrating) return 'celebrating';

  return deriveBaseMood({
    status,
    hasPendingConfirmation: signals.hasPendingConfirmation,
    hasReasoningStreaming: signals.hasReasoningStreaming,
    hasToolCallRunning: signals.hasToolCallRunning,
  });
}
