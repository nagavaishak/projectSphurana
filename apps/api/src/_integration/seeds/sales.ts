/**
 * Sales/POS-domain seed helpers.
 *
 * Kept in a sibling file (not harness.ts) so parallel agents can add domain
 * seeds without colliding. Shared helpers (seedOrgWithMember, seedService,
 * seedUser, …) live in ../harness.js and are imported by the spec directly.
 *
 * `seedSale` inserts a `sale` row straight into the DB — used by the
 * org-isolation test, which needs pre-existing rows in two orgs without going
 * through the create/add-item/pay pipeline. NOT-NULL columns required by the
 * `sale` table: organizationId, createdById (→ user.id, onDelete restrict).
 * Everything else has a DB default (status 'open', *_cents 0, currency 'eur').
 */
import { randomUUID } from 'node:crypto';
import { db, sale } from '@borradh-workspace/database';

export async function seedSale(input: {
  organizationId: string;
  /** Must reference a real user.id (FK, onDelete restrict). */
  createdById: string;
  status?: 'open' | 'completed' | 'voided';
  leadId?: string;
  subtotalCents?: number;
  totalCents?: number;
}): Promise<string> {
  const id = `sale_${randomUUID()}`;
  await db.insert(sale).values({
    id,
    organizationId: input.organizationId,
    createdById: input.createdById,
    leadId: input.leadId ?? null,
    status: input.status ?? 'open',
    subtotalCents: input.subtotalCents ?? 0,
    totalCents: input.totalCents ?? 0,
  });
  return id;
}
