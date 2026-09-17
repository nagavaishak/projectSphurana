import { describe, expect, it } from '@borradh-workspace/testing';
import {
  currencyForCode,
  currencyForCountry,
  currencyMinorUnitDigits,
  formatPrice,
} from './currency-for-country.js';

describe('currencyForCountry', () => {
  it('maps the US to USD ($)', () => {
    expect(currencyForCountry('us')).toEqual({ code: 'USD', symbol: '$' });
  });

  it('maps the UK to GBP (£)', () => {
    expect(currencyForCountry('gb')).toEqual({ code: 'GBP', symbol: '£' });
  });

  it('maps eurozone countries to EUR (€)', () => {
    for (const c of ['ie', 'fr', 'de', 'es', 'it']) {
      expect(currencyForCountry(c)).toEqual({ code: 'EUR', symbol: '€' });
    }
  });

  it('maps other dollar markets to a $ symbol', () => {
    expect(currencyForCountry('ca').symbol).toBe('$');
    expect(currencyForCountry('au').symbol).toBe('$');
    expect(currencyForCountry('nz').symbol).toBe('$');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(currencyForCountry(' US ').symbol).toBe('$');
  });

  it('falls back to EUR for unknown / missing countries', () => {
    expect(currencyForCountry(null)).toEqual({ code: 'EUR', symbol: '€' });
    expect(currencyForCountry(undefined)).toEqual({ code: 'EUR', symbol: '€' });
    expect(currencyForCountry('zz')).toEqual({ code: 'EUR', symbol: '€' });
  });
});

describe('formatPrice', () => {
  const usd = { code: 'USD', symbol: '$' };

  it('trims a whole-unit .00', () => {
    expect(formatPrice(16900, usd)).toBe('$169');
  });

  it('keeps cents when present', () => {
    expect(formatPrice(14950, usd)).toBe('$149.50');
  });

  it('uses the given symbol', () => {
    expect(formatPrice(16900, { code: 'EUR', symbol: '€' })).toBe('€169');
  });

  it('scales by the currency MINOR unit, not a hardcoded 100', () => {
    // JPY has no minor unit: 1500 minor units is ¥1500, not ¥15. Formatting it
    // as hundredths would render every price 100× low. Unreachable through the
    // ad path today (which is gated to 2-decimal currencies), but the divisor
    // must agree with `currencyMinorUnitDigits` in the same module.
    expect(formatPrice(1500, { code: 'JPY', symbol: '¥' })).toBe('¥1500');
  });

  it('uses 3 decimals for a 3-decimal currency', () => {
    expect(formatPrice(1500, { code: 'BHD', symbol: 'BD' })).toBe('BD1.500');
  });
});

describe('currencyForCode', () => {
  it('maps common markets to their symbols', () => {
    expect(currencyForCode('EUR')).toEqual({ code: 'EUR', symbol: '€' });
    expect(currencyForCode('GBP')).toEqual({ code: 'GBP', symbol: '£' });
    expect(currencyForCode('USD')).toEqual({ code: 'USD', symbol: '$' });
  });

  it('is case- and whitespace-insensitive', () => {
    expect(currencyForCode(' gbp ')).toEqual({ code: 'GBP', symbol: '£' });
  });

  it('derives a narrow symbol via Intl for unlisted valid currencies', () => {
    // Matches the frontend getCurrencySymbol so Claire's copy and the campaign
    // form never disagree for exotic currencies.
    expect(currencyForCode('SEK')).toEqual({ code: 'SEK', symbol: 'kr' });
    expect(currencyForCode('JPY')).toEqual({ code: 'JPY', symbol: '¥' });
  });

  it('echoes the ISO code for invalid currency codes', () => {
    expect(currencyForCode('ZZZ')).toEqual({ code: 'ZZZ', symbol: 'ZZZ' });
  });
});

describe('currencyMinorUnitDigits', () => {
  it('returns 2 for standard 2-decimal currencies', () => {
    expect(currencyMinorUnitDigits('EUR')).toBe(2);
    expect(currencyMinorUnitDigits('GBP')).toBe(2);
    expect(currencyMinorUnitDigits('USD')).toBe(2);
    expect(currencyMinorUnitDigits('SEK')).toBe(2);
  });

  it('returns 0 for zero-decimal currencies (the ×100 budget hazard)', () => {
    expect(currencyMinorUnitDigits('JPY')).toBe(0);
    expect(currencyMinorUnitDigits('KRW')).toBe(0);
  });

  it('returns 3 for three-decimal currencies', () => {
    expect(currencyMinorUnitDigits('BHD')).toBe(3);
  });

  it('defaults to 2 for invalid codes', () => {
    expect(currencyMinorUnitDigits('ZZZ')).toBe(2);
  });
});
