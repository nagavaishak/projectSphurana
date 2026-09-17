import { lead } from '@borradh-workspace/database';
import { and, eq, sql } from 'drizzle-orm';
import { type DbConnection, notDeleted } from '../../../shared/index.js';

/**
 * Record a completed visit's effect on a customer's lifetime value: stamp the
 * last-visit time and add to their lifetime spend. Lives in the leads feature
 * so the `lead` table keeps a single owning writer — sale/appointment write
 * paths call this rather than writing the lead row themselves.
 *
 * Runs on the caller's connection/transaction and returns nothing; callers
 * treat it as best-effort (a captured payment must not roll back on failure).
 */
export async function recordLeadVisitAndSpend(
  tx: DbConnection,
  input: {
    leadId: string;
    organizationId: string;
    addSpendCents: number;
    visitedAt?: Date;
  }
): Promise<void> {
  await tx
    .update(lead)
    .set({
      lastVisitAt: input.visitedAt ?? new Date(),
      lifetimeSpendCents: sql`${lead.lifetimeSpendCents} + ${input.addSpendCents}`,
    })
    .where(
      and(
        eq(lead.id, input.leadId),
        eq(lead.organizationId, input.organizationId),
        notDeleted(lead)
      )
    );
}
