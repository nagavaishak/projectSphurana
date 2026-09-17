/**
 * Org display currency, derived from the primary location's country.
 *
 * Mirrors `currencyForCountry` / `formatPrice` in
 * `packages/features/src/shared/currency-for-country.ts` (not exported through
 * the browser-safe `features/shared` public barrel, so the tiny pure mapping
 * is duplicated here). All API money values are integer cents; there is NO
 * org currency setting — the symbol is purely presentational.
 */

export interface OrgCurrency {
  /** ISO 4217 code, e.g. 'USD'. */
  code: string;
  /** Symbol to prefix a price with, e.g. '$' → "$169". */
  symbol: string;
}

const EUR: OrgCurrency = { code: 'EUR', symbol: '€' };
const USD: OrgCurrency = { code: 'USD', symbol: '$' };
const GBP: OrgCurrency = { code: 'GBP', symbol: '£' };

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

const COUNTRY_CURRENCY: Record<string, OrgCurrency> = {
  us: USD,
  gb: GBP,
  ca: { code: 'CAD', symbol: '$' },
  au: { code: 'AUD', symbol: '$' },
  nz: { code: 'NZD', symbol: '$' },
  ...Object.fromEntries(EUROZONE.map((c) => [c, EUR])),
};

/** Currency for an org located in `countryCode`; unknown/missing → EUR. */
export function currencyForCountry(countryCode?: string | null): OrgCurrency {
  const code = countryCode?.trim().toLowerCase() ?? '';
  return COUNTRY_CURRENCY[code] ?? EUR;
}

/**
 * Cents → a tidy price string ("$169", "€149.50"), trimming a whole-unit
 * ".00". Matches the backend `formatPrice` output.
 */
export function formatCents(cents: number, currency: OrgCurrency): string {
  const major = cents / 100;
  const str = Number.isInteger(major) ? String(major) : major.toFixed(2);
  return `${currency.symbol}${str}`;
}

/** Parse a user-entered major-unit amount ("12.50") into integer cents. */
export function parseMajorToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed.replace(',', '.'));
  if (Number.isNaN(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

/** Cents → editable major-unit string ("12.5" → "12.50", 1200 → "12"). */
export function centsToMajorString(cents: number | null | undefined): string {
  if (cents == null) return '';
  const major = cents / 100;
  return Number.isInteger(major) ? String(major) : major.toFixed(2);
}
