import type { SeedHelper } from '../fixtures/seed.fixture.js';

/** Minimal shapes of the sales/gift-card API responses these specs read back. */
interface SeededSale {
  id: string;
  totalCents: number;
  status: string;
  currency: string;
}
interface SeededGiftCard {
  id: string;
  code: string;
  balanceCents: number;
  initialAmountCents: number;
}

/**
 * Seed a fully-paid (CASH) sale through the real org-scoped API, mirroring the
 * POS flow: create the sale, add one line, then tender cash for the full total.
 * Cash settles instantly and the sale auto-completes WITHOUT Stripe — so the
 * completed sale surfaces on the Sales list and (for gift-card lines) issues a
 * gift card at completion.
 *
 * A `gift_card` line is the only line type that needs no other seeded entity
 * (service/product/membership all require an FK), which keeps the seed self
 * contained — and doubles as gift-card seeding.
 */
export async function seedCompletedCashSale(
  seed: SeedHelper,
  opts: { amountCents: number; itemName: string; leadId?: string }
): Promise<SeededSale> {
  const created = (await seed.authenticatedApiCall(
    'POST',
    '/sales',
    opts.leadId ? { leadId: opts.leadId } : {}
  )) as SeededSale;

  await seed.authenticatedApiCall('POST', `/sales/${created.id}/items`, {
    itemType: 'gift_card',
    name: opts.itemName,
    quantity: 1,
    unitPriceCents: opts.amountCents,
  });

  const paid = (await seed.authenticatedApiCall(
    'POST',
    `/sales/${created.id}/payments`,
    { method: 'cash', amountCents: opts.amountCents }
  )) as SeededSale;

  return paid;
}

/**
 * Seed an OPEN (unsettled) sale through the real org-scoped API: create the sale
 * and add one line, but tender NOTHING. The sale stays `open` — the only state
 * that can be VOIDED (void-sale.service rejects settled/completed sales, which
 * are reversed via refund instead). A `gift_card` line needs no other seeded FK.
 */
export async function seedOpenSale(
  seed: SeedHelper,
  opts: { amountCents: number; itemName: string; leadId?: string }
): Promise<SeededSale> {
  const created = (await seed.authenticatedApiCall(
    'POST',
    '/sales',
    opts.leadId ? { leadId: opts.leadId } : {}
  )) as SeededSale;

  await seed.authenticatedApiCall('POST', `/sales/${created.id}/items`, {
    itemType: 'gift_card',
    name: opts.itemName,
    quantity: 1,
    unitPriceCents: opts.amountCents,
  });

  return created;
}

/** Read back the gift cards for the active org (newest issuance included). */
export async function listGiftCards(
  seed: SeedHelper
): Promise<SeededGiftCard[]> {
  const res = (await seed.authenticatedApiCall('GET', '/gift-cards')) as
    | SeededGiftCard[]
    | { items?: SeededGiftCard[] };
  return Array.isArray(res) ? res : (res.items ?? []);
}

/** Create a lead so a seeded sale carries a unique, assertable client name. */
export async function seedLead(
  seed: SeedHelper,
  firstName: string
): Promise<string> {
  const lead = (await seed.authenticatedApiCall('POST', '/leads', {
    firstName,
  })) as { id: string };
  return lead.id;
}
