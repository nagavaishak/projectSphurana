/**
 * Money is stored as integer cents everywhere in the POS/sales domain
 * (contract §1.2, §6). Currency comes from the entity's own `currency` field
 * (set from the org's primary location country at creation) — there is no org
 * currency setting. This is a small display helper local to the client profile
 * so the feature stays self-contained.
 */
export function formatMoney(cents: number, currency = 'eur'): string {
  const amount = (cents ?? 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Unknown/invalid currency code — fall back to a plain number.
    return amount.toFixed(2);
  }
}
