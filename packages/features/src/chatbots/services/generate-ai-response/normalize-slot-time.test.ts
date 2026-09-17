import { describe, expect, it } from 'vitest';
import {
  buildAlternativesMessage,
  normalizeSlotTime,
} from './generate-ai-response.service.js';

describe('normalizeSlotTime', () => {
  it('passes through the 24-hour form the prompt asks for', () => {
    expect(normalizeSlotTime('14:00')).toBe('14:00');
    expect(normalizeSlotTime('09:30')).toBe('09:30');
    expect(normalizeSlotTime('9:30')).toBe('09:30');
  });

  it('accepts the 12-hour forms models actually emit', () => {
    expect(normalizeSlotTime('2:00 PM')).toBe('14:00');
    expect(normalizeSlotTime('2pm')).toBe('14:00');
    expect(normalizeSlotTime('2 p.m.')).toBe('14:00');
    expect(normalizeSlotTime('12:00 AM')).toBe('00:00');
    expect(normalizeSlotTime('12:00 PM')).toBe('12:00');
  });

  it('returns null rather than guessing at anything else', () => {
    // A null here means "no matching slot", never "book the nearest thing".
    expect(normalizeSlotTime('afternoon')).toBeNull();
    expect(normalizeSlotTime('')).toBeNull();
    expect(normalizeSlotTime('25:00')).toBeNull();
    expect(normalizeSlotTime('14:75')).toBeNull();
    expect(normalizeSlotTime('sometime Thursday')).toBeNull();
  });
});

describe('buildAlternativesMessage', () => {
  const slots = [
    { displayTime: '10 AM' },
    { displayTime: '2 PM' },
    { displayTime: '5:30 PM' },
    { displayTime: '6 PM' },
  ];

  it('offers real times spread across the day', () => {
    const message = buildAlternativesMessage(slots);
    expect(message).toContain('10 AM');
    expect(message).toContain('6 PM');
  });

  it('says so plainly when the day is full', () => {
    const message = buildAlternativesMessage([]);
    expect(message).toMatch(/nothing else left that day/i);
    expect(message).toMatch(/another day/i);
  });

  it('distinguishes a slot that was just taken', () => {
    expect(buildAlternativesMessage(slots, 'taken')).toMatch(/just gone/i);
  });

  it('never promises a callback or a pending process', () => {
    for (const cause of ['unavailable', 'taken'] as const) {
      const message = buildAlternativesMessage(slots, cause);
      expect(message).not.toMatch(
        /arrang|process|I'll confirm|get back to you/i
      );
    }
  });
});
