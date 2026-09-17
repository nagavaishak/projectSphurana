import { describe, expect, it } from 'vitest';
import {
  FOLLOW_UP_DELAYS_MS,
  MAX_FOLLOW_UPS,
  MSG_PART_DELAY_MS,
  getFollowUpMessage,
} from './follow-up-config.js';

describe('follow-up-config', () => {
  describe('FOLLOW_UP_DELAYS_MS', () => {
    it('should have 3 delay entries matching MAX_FOLLOW_UPS', () => {
      expect(Object.keys(FOLLOW_UP_DELAYS_MS)).toHaveLength(MAX_FOLLOW_UPS);
    });

    it('should have all positive delay values', () => {
      for (const delay of Object.values(FOLLOW_UP_DELAYS_MS)) {
        expect(delay).toBeGreaterThan(0);
      }
    });

    it('should have increasing delays', () => {
      expect(FOLLOW_UP_DELAYS_MS[0]).toBeLessThan(FOLLOW_UP_DELAYS_MS[1] ?? 0);
      expect(FOLLOW_UP_DELAYS_MS[1]).toBeLessThan(FOLLOW_UP_DELAYS_MS[2] ?? 0);
    });

    it('should have correct delay for stage 0 (30 minutes)', () => {
      expect(FOLLOW_UP_DELAYS_MS[0]).toBe(30 * 60 * 1000);
    });

    it('should have correct delay for stage 1 (2 hours)', () => {
      expect(FOLLOW_UP_DELAYS_MS[1]).toBe(2 * 60 * 60 * 1000);
    });

    it('should have correct delay for stage 2 (20 hours)', () => {
      expect(FOLLOW_UP_DELAYS_MS[2]).toBe(20 * 60 * 60 * 1000);
    });
  });

  describe('MSG_PART_DELAY_MS', () => {
    it('should be a positive number', () => {
      expect(MSG_PART_DELAY_MS).toBeGreaterThan(0);
    });
  });

  describe('getFollowUpMessage', () => {
    it('should return stage 1 message with user name', () => {
      const msg = getFollowUpMessage(1, 'Sarah');
      expect(msg).toContain('Follow-up 1 of 3');
      expect(msg).toContain('Sarah');
      expect(msg).toContain('30 minutes');
    });

    it('should return stage 2 message with user name', () => {
      const msg = getFollowUpMessage(2, 'Sarah');
      expect(msg).toContain('Follow-up 2 of 3');
      expect(msg).toContain('Sarah');
      expect(msg).toContain('consultation');
    });

    it('should return stage 3 message with user name', () => {
      const msg = getFollowUpMessage(3, 'Sarah');
      expect(msg).toContain('Follow-up 3 of 3');
      expect(msg).toContain('FINAL');
      expect(msg).toContain('Sarah');
    });

    it('should return stage 3+ message for stages beyond 3', () => {
      const msg = getFollowUpMessage(5, 'Sarah');
      expect(msg).toContain('Follow-up 3 of 3');
      expect(msg).toContain('FINAL');
    });

    it('should fall back to "there" when no user name provided', () => {
      const msg = getFollowUpMessage(1);
      expect(msg).toContain('"there"');
      expect(msg).not.toContain('undefined');
    });

    it('should fall back to "there" when user name is undefined', () => {
      const msg = getFollowUpMessage(2, undefined);
      expect(msg).toContain('"there"');
    });

    it('stage 1 should not mention booking or consultation', () => {
      const msg = getFollowUpMessage(1, 'Sarah');
      expect(msg).toContain('Do NOT include the booking link');
      expect(msg).toContain('Do NOT push to book');
    });

    it('stage 2 can include booking link', () => {
      const msg = getFollowUpMessage(2, 'Sarah');
      expect(msg).toContain('CAN include the booking link');
    });

    it('stage 3 should indicate it is the last message', () => {
      const msg = getFollowUpMessage(3, 'Sarah');
      expect(msg).toContain('LAST message');
      expect(msg).toContain('dormant');
    });
  });
});
