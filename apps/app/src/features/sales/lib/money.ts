/**
 * Money display helpers for the POS / sales surfaces.
 *
 * The API stores and returns money as integer **cents**. Every sale carries a
 * lowercase ISO currency code (e.g. `'eur'`) derived server-side from the org's
 * primary location country. Display code should always go through these
 * helpers rather than dividing by 100 inline.
 */

/** Format integer cents as a localized currency string. */
export function formatMoney(cents: number, currency = 'eur'): string {
  const amount = (cents ?? 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (currency || 'eur').toUpperCase(),
      currencyDisplay: 'narrowSymbol',
    }).format(amount);
  } catch {
    // Unknown currency code — fall back to a plain formatted number.
    return `${(currency || '').toUpperCase()} ${amount.toFixed(2)}`.trim();
  }
}

/** The narrow currency symbol for a code (e.g. `'eur'` → `'€'`). */
export function currencySymbol(currency = 'eur'): string {
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (currency || 'eur').toUpperCase(),
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return (currency || '').toUpperCase();
  }
}

/**
 * Best-effort parse of a freeform price string (services store `priceText`,
 * not cents) into integer cents. Returns 0 when nothing numeric is found.
 */
export function parsePriceTextToCents(priceText?: string | null): number {
  if (!priceText) return 0;
  const match = priceText.replace(/,/g, '').match(/\d+(?:\.\d{1,2})?/);
  if (!match) return 0;
  return Math.round(Number.parseFloat(match[0]) * 100);
}

/** Convert a decimal currency amount (e.g. `12.50`) to integer cents. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}
