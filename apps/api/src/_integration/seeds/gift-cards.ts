/**
 * Gift-cards seed helpers for the integration harness.
 *
 * Kept out of harness.ts (per the harness "do not edit" rule): this file only
 * inserts real `gift_card` / `gift_card_transaction` rows so the real feature
 * services + SQL under test have data to read/mutate. Shared org/user/member
 * seeding is re-used from ../harness.js by the spec.
 *
 * NOT-NULL columns on `gift_card` with no DB default: organizationId, code,
 * initialAmountCents, balanceCents. `currency` defaults to 'eur'; `id` defaults
 * to a cuid2 — we pass an explicit id so we can return it.
 */
import { randomUUID } from 'node:crypto';
import { db, giftCard } from '@borradh-workspace/database';

/**
 * Insert a real `gift_card` row scoped to an org. Returns its id.
 *
 * `balanceCents` defaults to `initialAmountCents` (a freshly issued card).
 * `code` defaults to a unique GC-style code; the (organizationId, code) pair is
 * uniquely constrained, so pass distinct codes when seeding many in one org.
 */
export async function seedGiftCard(input: {
  organizationId: string;
  code?: string;
  balanceCents?: number;
  initialAmountCents?: number;
  currency?: string;
  leadId?: string;
}): Promise<string> {
  const id = `gc_${randomUUID()}`;
  const initialAmountCents = input.initialAmountCents ?? 5000;
  await db.insert(giftCard).values({
    id,
    organizationId: input.organizationId,
    code: input.code ?? `GC-${randomUUID().slice(0, 13).toUpperCase()}`,
    initialAmountCents,
    balanceCents: input.balanceCents ?? initialAmountCents,
    currency: input.currency ?? 'eur',
    leadId: input.leadId ?? null,
  });
  return id;
}

/**
 * Count ledger rows for a gift card (used to assert a transaction was recorded).
 */
export async function countGiftCardTransactions(
  giftCardId: string
): Promise<number> {
  const rows = await db.query.giftCardTransaction.findMany({
    where: (t, { eq }) => eq(t.giftCardId, giftCardId),
  });
  return rows.length;
}
