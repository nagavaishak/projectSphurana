import { ApiFetchError } from '../../tool-factory/api-fetch.js';
import {
  resolveToolDate,
  resolveToolDateTime,
  resolveToolRangePreset,
} from './resolve-tool-date.js';

/**
 * Phase 3 (Claire reliability overhaul) — the tool-facing date resolver wraps
 * the shared `@borradh-workspace/features/shared` resolver with the org
 * timezone and turns unresolvable expressions into an ApiFetchError(400) whose
 * message quotes today. These tests pin the clock so relative expressions are
 * deterministic.
 */
describe('resolve-tool-date', () => {
  beforeAll(() => {
    // Wednesday 29 July 2026, noon UTC.
    jest.useFakeTimers().setSystemTime(new Date('2026-07-29T12:00:00Z'));
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  describe('resolveToolDateTime', () => {
    it('resolves "in 2 weeks" (end of day) in the org timezone', () => {
      // 29 Jul + 14 days = 12 Aug; end-of-day 23:59 Europe/Dublin (UTC+1).
      const iso = resolveToolDateTime('in 2 weeks', 'Europe/Dublin', 'end');
      expect(iso.startsWith('2026-08-12T22:59')).toBe(true);
    });

    it('resolves "until August 7th" into the FUTURE, not the past (#158)', () => {
      const iso = resolveToolDateTime(
        'until August 7th',
        'Europe/Dublin',
        'end'
      );
      expect(iso.startsWith('2026-08-07')).toBe(true);
    });

    it('passes an absolute ISO datetime through unchanged', () => {
      const iso = resolveToolDateTime(
        '2026-09-01T14:00:00Z',
        'Europe/Dublin',
        'start'
      );
      expect(iso).toBe('2026-09-01T14:00:00.000Z');
    });

    it('throws ApiFetchError(400) quoting today when unresolvable', () => {
      try {
        resolveToolDateTime('sometime soon-ish', 'Europe/Dublin', 'end');
        throw new Error('expected throw');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiFetchError);
        expect((error as ApiFetchError).status).toBe(400);
        expect((error as ApiFetchError).message).toContain('2026-07-29');
      }
    });
  });

  describe('resolveToolDate', () => {
    it('resolves "tomorrow" to the next calendar date (#208)', () => {
      expect(resolveToolDate('tomorrow', 'Europe/Dublin')).toBe('2026-07-30');
    });

    it('resolves an ISO date through unchanged', () => {
      expect(resolveToolDate('2026-08-07', 'Europe/Dublin')).toBe('2026-08-07');
    });
  });

  describe('resolveToolRangePreset', () => {
    it('resolves this_week to the Mon–Sun window containing today (#193)', () => {
      // 29 Jul 2026 is a Wednesday → week is Mon 27 Jul – Sun 2 Aug.
      expect(resolveToolRangePreset('this_week', 'Europe/Dublin')).toEqual({
        since: '2026-07-27',
        until: '2026-08-02',
      });
    });

    it('resolves last_7_days to the trailing 7-day window', () => {
      expect(resolveToolRangePreset('last_7_days', 'Europe/Dublin')).toEqual({
        since: '2026-07-23',
        until: '2026-07-29',
      });
    });
  });
});
