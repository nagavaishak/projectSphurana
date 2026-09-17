import { describe, expect, it } from 'vitest';
import {
  currencySymbol,
  formatMoney,
  parsePriceTextToCents,
  toCents,
} from './money';

describe('money helpers', () => {
  describe('formatMoney', () => {
    it('formats integer cents as a narrow-symbol currency string', () => {
      expect(formatMoney(4000, 'eur')).toBe('€40.00');
      expect(formatMoney(1250, 'usd')).toBe('$12.50');
    });

    it('treats null/zero cents as 0', () => {
      expect(formatMoney(0, 'eur')).toBe('€0.00');
      expect(formatMoney(null as unknown as number, 'eur')).toBe('€0.00');
    });

    it('falls back to a plain formatted number for an invalid currency', () => {
      // A non-3-letter code makes Intl throw, exercising the catch fallback.
      expect(formatMoney(1000, 'zz')).toBe('ZZ 10.00');
    });
  });

  describe('currencySymbol', () => {
    it('returns the narrow symbol for a known code', () => {
      expect(currencySymbol('eur')).toBe('€');
      expect(currencySymbol('gbp')).toBe('£');
    });
  });

  describe('parsePriceTextToCents', () => {
    it('extracts the first numeric amount as integer cents', () => {
      expect(parsePriceTextToCents('€40')).toBe(4000);
      expect(parsePriceTextToCents('from 12.50')).toBe(1250);
      expect(parsePriceTextToCents('1,299.99')).toBe(129999);
    });

    it('returns 0 when there is nothing numeric', () => {
      expect(parsePriceTextToCents('Free')).toBe(0);
      expect(parsePriceTextToCents(null)).toBe(0);
      expect(parsePriceTextToCents(undefined)).toBe(0);
    });
  });

  describe('toCents', () => {
    it('rounds a decimal amount to integer cents', () => {
      expect(toCents(12.5)).toBe(1250);
      expect(toCents(0.1 + 0.2)).toBe(30);
    });
  });
});
