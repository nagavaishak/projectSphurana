import { type Lead, lead, leadActivity } from '@borradh-workspace/database';
import { and, eq, isNull } from 'drizzle-orm';
import { type DbConnection, notDeleted } from '../../../shared/index.js';

/**
 * Stamp a lead's conversion — the one stage fact that has to be written rather
 * than derived, because it is a MEMO: `converted_at` is the earliest of the
 * first appointment and the first paid sale, and recomputing that on every list
 * request would mean joining `appointment` and `sale` for every row.
 *
 * Stamped exactly once. The `converted_at IS NULL` predicate is in the WHERE,
 * not a read-then-write, so two concurrent bookings cannot race the date
 * backwards or forwards.
 *
 * `lead.status` is left alone. It is no longer the pipeline stage (see
 * `derived-stage.ts`) — it now carries only the explicit `lost` mark, and a
 * booking must not silently un-lose somebody.
 *
 * Runs on the caller's connection/transaction. Callers treat it as
 * best-effort: a failure here must never fail the booking or the payment.
 */
export async function recordLeadConversion(
  tx: DbConnection,
  input: {
    leadId: string;
    organizationId: string;
    convertedAt?: Date;
    /** `lead_activity.type` — e.g. 'appointment_booked', 'sale_completed'. */
    activityType: string;
    activityDescription: string;
    actorId?: string | null;
  }
): Promise<Lead | undefined> {
  const [updated] = await tx
    .update(lead)
    .set({ convertedAt: input.convertedAt ?? new Date() })
    .where(
      and(
        eq(lead.id, input.leadId),
        eq(lead.organizationId, input.organizationId),
        isNull(lead.convertedAt),
        notDeleted(lead)
      )
    )
    .returning();

  // No row updated => already converted. The activity row belongs to the FIRST
  // conversion only, so a second booking writes nothing.
  if (!updated) return undefined;

  await tx.insert(leadActivity).values({
    leadId: input.leadId,
    type: input.activityType,
    description: input.activityDescription,
    performedById: input.actorId ?? null,
  });

  return updated;
}
