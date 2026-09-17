import { FOLLOW_UP_DELAYS_MS, MAX_FOLLOW_UPS } from './follow-up-config.js';

const TERMINAL_PATTERNS = [
  /^(thanks?|thank you|cheers|ta|ty|thx)(\s+so much)?(\s+for\s+\w+)?\s*(?:[.!x]|💜|🫶🏻|👌🏻|👍)*\s*$/iu,
  /^(ok|okay|perfect|great|lovely|brilliant|cool|grand|deadly|sound)\s*(perfect|thanks?|thank you|cheers|ta)?\s*(?:[.!x]|💜|🫶🏻|👌🏻|👍)*\s*$/iu,
  /^(bye|goodbye|talk soon|have a good)\b/i,
  /^(no\s+)?(?:that[''\u2019]s (?:all|it|everything)|nope|nothing else)\s*[.!x]*\s*$/i,
  /^(will do|sure|noted)\s*(thanks?|cheers|ta)?\s*[.!x]*\s*$/i,
];

export function isTerminalMessage(message: string | undefined): boolean {
  if (!message) return false;
  const trimmed = message.trim();
  if (trimmed.length > 80) return false; // Long messages are not terminal
  return TERMINAL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export interface ComputeFollowUpInput {
  stoppedAt: 'delay' | 'waiting' | 'end' | 'handoff' | 'silent_handoff';
  currentFollowUpCount: number;
  triggerType: string;
  followUpEnabled: boolean;
  delayMs?: number;
  newNodeId?: string | null;
  lastUserMessage?: string;
}

export interface FollowUpAction {
  action: 'schedule_delay' | 'schedule_follow_up' | 'final_follow_up' | 'skip';
  delayMs?: number;
  nextFollowUpNumber?: number;
}

/**
 * Compute what follow-up action should be taken based on the flow stop reason
 * and current follow-up state.
 */
export function computeFollowUpAction(
  input: ComputeFollowUpInput
): FollowUpAction {
  const {
    stoppedAt,
    currentFollowUpCount,
    triggerType,
    followUpEnabled,
    delayMs,
    newNodeId,
    lastUserMessage,
  } = input;

  switch (stoppedAt) {
    case 'delay': {
      if (delayMs && newNodeId) {
        return { action: 'schedule_delay', delayMs };
      }
      return { action: 'skip' };
    }

    case 'waiting': {
      if (!followUpEnabled) {
        return { action: 'skip' };
      }

      // Skip follow-up if user sent a terminal/closing message
      if (lastUserMessage && isTerminalMessage(lastUserMessage)) {
        return { action: 'skip' };
      }

      if (
        triggerType === 'follow_up' &&
        currentFollowUpCount >= MAX_FOLLOW_UPS
      ) {
        return { action: 'final_follow_up' };
      }

      const nextFollowUpIndex = currentFollowUpCount;
      const delayForNext =
        FOLLOW_UP_DELAYS_MS[nextFollowUpIndex] ?? FOLLOW_UP_DELAYS_MS[0];

      return {
        action: 'schedule_follow_up',
        delayMs: delayForNext,
        nextFollowUpNumber: nextFollowUpIndex + 1,
      };
    }

    case 'handoff':
    case 'silent_handoff':
    case 'end':
      return { action: 'skip' };

    default:
      return { action: 'skip' };
  }
}
