import { describe, expect, it } from 'vitest';
import { FOLLOW_UP_DELAYS_MS, MAX_FOLLOW_UPS } from './follow-up-config.js';
import {
  type ComputeFollowUpInput,
  computeFollowUpAction,
  isTerminalMessage,
} from './schedule-follow-up.js';

describe('computeFollowUpAction', () => {
  const makeInput = (
    overrides: Partial<ComputeFollowUpInput> = {}
  ): ComputeFollowUpInput => ({
    stoppedAt: 'waiting',
    currentFollowUpCount: 0,
    triggerType: 'message',
    followUpEnabled: true,
    ...overrides,
  });

  describe('waiting state', () => {
    it('should schedule follow-up 1 after initial conversation', () => {
      const result = computeFollowUpAction(makeInput());

      expect(result.action).toBe('schedule_follow_up');
      expect(result.delayMs).toBe(FOLLOW_UP_DELAYS_MS[0]);
      expect(result.nextFollowUpNumber).toBe(1);
    });

    it('should schedule follow-up 2 with longer delay', () => {
      const result = computeFollowUpAction(
        makeInput({
          currentFollowUpCount: 1,
          triggerType: 'follow_up',
        })
      );

      expect(result.action).toBe('schedule_follow_up');
      expect(result.delayMs).toBe(FOLLOW_UP_DELAYS_MS[1]);
      expect(result.nextFollowUpNumber).toBe(2);
    });

    it('should schedule follow-up 3 with longest delay', () => {
      const result = computeFollowUpAction(
        makeInput({
          currentFollowUpCount: 2,
          triggerType: 'follow_up',
        })
      );

      expect(result.action).toBe('schedule_follow_up');
      expect(result.delayMs).toBe(FOLLOW_UP_DELAYS_MS[2]);
      expect(result.nextFollowUpNumber).toBe(3);
    });

    it('should return final_follow_up when max follow-ups reached', () => {
      const result = computeFollowUpAction(
        makeInput({
          currentFollowUpCount: MAX_FOLLOW_UPS,
          triggerType: 'follow_up',
        })
      );

      expect(result.action).toBe('final_follow_up');
    });

    it('should skip when follow-up is disabled', () => {
      const result = computeFollowUpAction(
        makeInput({
          followUpEnabled: false,
        })
      );

      expect(result.action).toBe('skip');
    });

    it('should use correct delay for each stage', () => {
      for (let i = 0; i < MAX_FOLLOW_UPS; i++) {
        const result = computeFollowUpAction(
          makeInput({
            currentFollowUpCount: i,
          })
        );
        expect(result.delayMs).toBe(FOLLOW_UP_DELAYS_MS[i]);
      }
    });

    it('should fall back to first delay for out-of-range count', () => {
      const result = computeFollowUpAction(
        makeInput({
          currentFollowUpCount: 99,
        })
      );

      expect(result.delayMs).toBe(FOLLOW_UP_DELAYS_MS[0]);
    });
  });

  describe('delay state', () => {
    it('should schedule delay when delayMs and newNodeId present', () => {
      const result = computeFollowUpAction(
        makeInput({
          stoppedAt: 'delay',
          delayMs: 5000,
          newNodeId: 'node-1',
        })
      );

      expect(result.action).toBe('schedule_delay');
      expect(result.delayMs).toBe(5000);
    });

    it('should skip delay when delayMs missing', () => {
      const result = computeFollowUpAction(
        makeInput({
          stoppedAt: 'delay',
          newNodeId: 'node-1',
        })
      );

      expect(result.action).toBe('skip');
    });

    it('should skip delay when newNodeId missing', () => {
      const result = computeFollowUpAction(
        makeInput({
          stoppedAt: 'delay',
          delayMs: 5000,
          newNodeId: null,
        })
      );

      expect(result.action).toBe('skip');
    });
  });

  describe('handoff state', () => {
    it('should skip (no follow-up)', () => {
      const result = computeFollowUpAction(makeInput({ stoppedAt: 'handoff' }));
      expect(result.action).toBe('skip');
    });
  });

  describe('silent_handoff state', () => {
    it('should skip (no follow-up)', () => {
      const result = computeFollowUpAction(
        makeInput({ stoppedAt: 'silent_handoff' })
      );
      expect(result.action).toBe('skip');
    });
  });

  describe('end state', () => {
    it('should skip (no follow-up)', () => {
      const result = computeFollowUpAction(makeInput({ stoppedAt: 'end' }));
      expect(result.action).toBe('skip');
    });
  });

  describe('terminal message detection', () => {
    it('skips follow-up when last user message is "thanks"', () => {
      const result = computeFollowUpAction(
        makeInput({ lastUserMessage: 'thanks' })
      );
      expect(result.action).toBe('skip');
    });

    it('skips follow-up for "ok perfect"', () => {
      const result = computeFollowUpAction(
        makeInput({ lastUserMessage: 'ok perfect' })
      );
      expect(result.action).toBe('skip');
    });

    it('skips follow-up for "great thanks x"', () => {
      const result = computeFollowUpAction(
        makeInput({ lastUserMessage: 'great thanks x' })
      );
      expect(result.action).toBe('skip');
    });

    it('skips follow-up for "cheers"', () => {
      const result = computeFollowUpAction(
        makeInput({ lastUserMessage: 'cheers' })
      );
      expect(result.action).toBe('skip');
    });

    it('skips follow-up for "bye"', () => {
      const result = computeFollowUpAction(
        makeInput({ lastUserMessage: 'bye' })
      );
      expect(result.action).toBe('skip');
    });

    it('skips follow-up for "no that\'s all"', () => {
      const result = computeFollowUpAction(
        makeInput({ lastUserMessage: "no that's all" })
      );
      expect(result.action).toBe('skip');
    });

    it('skips follow-up for "Thank you so much xx" (case insensitive)', () => {
      const result = computeFollowUpAction(
        makeInput({ lastUserMessage: 'Thank you so much xx' })
      );
      expect(result.action).toBe('skip');
    });

    it('does NOT skip for "thanks, what about pricing?" (question continues)', () => {
      const result = computeFollowUpAction(
        makeInput({ lastUserMessage: 'thanks, what about pricing?' })
      );
      expect(result.action).toBe('schedule_follow_up');
    });

    it('does NOT skip for "ok so can I book for Tuesday?" (booking intent)', () => {
      const result = computeFollowUpAction(
        makeInput({ lastUserMessage: 'ok so can I book for Tuesday?' })
      );
      expect(result.action).toBe('schedule_follow_up');
    });

    it('does NOT skip when stoppedAt is "handoff" (different stop reason)', () => {
      const result = computeFollowUpAction(
        makeInput({ stoppedAt: 'handoff', lastUserMessage: 'thanks' })
      );
      expect(result.action).toBe('skip');
    });

    it('does NOT skip when stoppedAt is "end" (already ending)', () => {
      const result = computeFollowUpAction(
        makeInput({ stoppedAt: 'end', lastUserMessage: 'thanks' })
      );
      expect(result.action).toBe('skip');
    });

    it('does NOT skip when lastUserMessage is undefined (no message)', () => {
      const result = computeFollowUpAction(
        makeInput({ lastUserMessage: undefined })
      );
      expect(result.action).toBe('schedule_follow_up');
    });

    it('does NOT skip for "thanks for explaining, I have another question" (long message with question)', () => {
      const result = computeFollowUpAction(
        makeInput({
          lastUserMessage: 'thanks for explaining, I have another question',
        })
      );
      expect(result.action).toBe('schedule_follow_up');
    });

    it('existing tests still pass with lastUserMessage undefined (backward compatibility)', () => {
      const result = computeFollowUpAction(makeInput());
      expect(result.action).toBe('schedule_follow_up');
      expect(result.delayMs).toBe(FOLLOW_UP_DELAYS_MS[0]);
      expect(result.nextFollowUpNumber).toBe(1);
    });
  });
});

describe('isTerminalMessage', () => {
  it('returns true for "thanks"', () => {
    expect(isTerminalMessage('thanks')).toBe(true);
  });

  it('returns true for "Ok 👍"', () => {
    expect(isTerminalMessage('Ok 👍')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isTerminalMessage('')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isTerminalMessage(undefined)).toBe(false);
  });

  it('returns false for messages longer than 80 chars', () => {
    const longMessage = 'thanks '.repeat(20).trim();
    expect(longMessage.length).toBeGreaterThan(80);
    expect(isTerminalMessage(longMessage)).toBe(false);
  });
});
