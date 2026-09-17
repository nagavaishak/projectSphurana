/**
 * Pure currency helpers — no I/O, no DB, no Node built-ins — so this module is
 * safe to expose on the frontend/mobile `./shared` public surface.
 *
 * `getOrgCurrency` (which reads the org's location from the DB) lives in
 * `./currency-for-country.js`, NOT here, so importing these pure helpers never
 * drags Drizzle into a browser bundle.
 *
 * Offer prices are stored as a raw integer in `*_cents` columns with NO
 * currency attached, so the symbol shown on an ad — caption, on-image badge,
 * video — is a presentation choice derived either from the org's country
 * (`currencyForCountry`) or from an authoritative ISO code such as a Meta ad
 * account's or Stripe's currency (`currencyForCode`).
 */

export interface Currency {
  /** ISO 4217 code, e.g. 'USD'. */
  code: string;
  /** Symbol to prefix a price with, e.g. '$' → "$169". */
  symbol: string;
}

const EUR: Currency = { code: 'EUR', symbol: '€' };
const USD: Currency = { code: 'USD', symbol: '$' };
const GBP: Currency = { code: 'GBP', symbol: '£' };

/** Eurozone (and euro-using microstates) — all render "€". */
const EUROZONE = [
  'at',
  'ad',
  'be',
  'hr',
  'cy',
  'ee',
  'fi',
  'fr',
  'de',
  'gr',
  'ie',
  'it',
  'lv',
  'lt',
  'lu',
  'mt',
  'mc',
  'me',
  'nl',
  'pt',
  'sm',
  'sk',
  'si',
  'es',
  'va',
] as const;

/**
 * Lowercase ISO-3166 alpha-2 → currency. Only the markets we knowingly serve
 * are listed; everything else falls back to EUR via `currencyForCountry`.
 */
const COUNTRY_CURRENCY: Record<string, Currency> = {
  us: USD,
  gb: GBP,
  // Dollar markets that read naturally with a bare "$" on an ad.
  ca: { code: 'CAD', symbol: '$' },
  au: { code: 'AUD', symbol: '$' },
  nz: { code: 'NZD', symbol: '$' },
  ...Object.fromEntries(EUROZONE.map((c) => [c, EUR])),
};

/**
 * The currency to display for an org located in `countryCode`. Falls back to
 * EUR for unknown / missing countries (the historical default).
 */
export function currencyForCountry(countryCode?: string | null): Currency {
  const code = countryCode?.trim().toLowerCase() ?? '';
  return COUNTRY_CURRENCY[code] ?? EUR;
}

/** Lowercase ISO-4217 code (as Stripe reports `default_currency`) → Currency. */
const CODE_CURRENCY: Record<string, Currency> = {
  eur: EUR,
  usd: USD,
  gbp: GBP,
  cad: { code: 'CAD', symbol: '$' },
  aud: { code: 'AUD', symbol: '$' },
  nzd: { code: 'NZD', symbol: '$' },
};

/**
 * The Currency for an ISO-4217 currency code (e.g. Stripe's `default_currency`,
 * or a Meta ad account's `currency`). Use when the authoritative signal is the
 * currency itself rather than a country.
 *
 * Common markets are mapped explicitly; any other valid ISO code derives its
 * narrow symbol via `Intl` (e.g. SEK → "kr", JPY → "¥"), matching the
 * frontend's `getCurrencySymbol` so the two never disagree. An invalid code
 * (Intl throws) echoes the uppercased code so the value is never silently wrong.
 */
export function currencyForCode(currencyCode: string): Currency {
  const code = currencyCode.trim().toLowerCase();
  const mapped = CODE_CURRENCY[code];
  if (mapped) return mapped;

  const upper = code.toUpperCase();
  try {
    const parts = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: upper,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    const symbol = parts.find((p) => p.type === 'currency')?.value ?? upper;
    return { code: upper, symbol };
  } catch {
    return { code: upper, symbol: upper };
  }
}

/**
 * Number of minor-unit decimal places for an ISO currency code — 2 for
 * EUR/GBP/USD/SEK, 0 for JPY/KRW, 3 for BHD/KWD, via Intl. Use this to guard
 * money math that assumes a fixed minor unit (e.g. the Meta ad-budget path
 * multiplies by 100, which is only correct for 2-decimal currencies). Invalid
 * codes default to 2.
 */
export function currencyMinorUnitDigits(currencyCode: string): number {
  try {
    return (
      new Intl.NumberFormat('en', {
        style: 'currency',
        currency: currencyCode.trim().toUpperCase(),
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/**
 * Minor units → a tidy price string in the given currency ("$169", "€149.50"),
 * trimming a whole-unit ".00".
 *
 * The `*_cents` columns hold the currency's MINOR unit, so the divisor comes
 * from `currencyMinorUnitDigits` rather than a hardcoded 100. For every
 * currency this codebase resolves today (EUR/GBP/USD via `currencyForCountry`,
 * and the 2-decimal-only ad-account path) that is 100 and the output is
 * unchanged — but a 0-decimal currency like JPY would otherwise render 100×
 * low, and the two helpers in this file would disagree about what a minor unit
 * is.
 */
export function formatPrice(minorUnits: number, currency: Currency): string {
  const digits = currencyMinorUnitDigits(currency.code);
  const major = minorUnits / 10 ** digits;
  const str = Number.isInteger(major) ? String(major) : major.toFixed(digits);
  return `${currency.symbol}${str}`;
}
