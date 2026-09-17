import { appointmentDeposit } from '@borradh-workspace/database';
import { inArray } from 'drizzle-orm';
import type { DbConnection } from '../../shared/index.js';
import type { AppointmentWithRelations } from '../models/index.js';

type DepositRow = typeof appointmentDeposit.$inferSelect;

/** The trimmed deposit shape attached to appointment read models. */
export type EffectiveDeposit = NonNullable<AppointmentWithRelations['deposit']>;

/**
 * Pick the single deposit worth showing for an appointment out of its (possibly
 * multiple) deposit rows: the paid one wins, otherwise the most recently created
 * — so an expired attempt never masks a later, live or paid deposit.
 */
export function pickEffectiveDeposit(
  rows: readonly DepositRow[]
): EffectiveDeposit | null {
  if (rows.length === 0) return null;
  const paid = rows.find((r) => r.status === 'paid');
  const chosen =
    paid ??
    [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return {
    status: chosen.status,
    amountCents: chosen.amountCents,
    currency: chosen.currency,
    paidAt: chosen.paidAt,
  };
}

/**
 * Load the effective deposit for each appointment id in one query and return a
 * Map keyed by appointmentId. Appointments with no deposit row are simply absent
 * from the map (callers default to null). Runs on the passed (org-scoped)
 * connection.
 */
export async function loadEffectiveDeposits(
  db: DbConnection,
  appointmentIds: readonly string[]
): Promise<Map<string, EffectiveDeposit>> {
  const byAppointment = new Map<string, EffectiveDeposit>();
  if (appointmentIds.length === 0) return byAppointment;

  const rows = await db.query.appointmentDeposit.findMany({
    where: inArray(appointmentDeposit.appointmentId, [...appointmentIds]),
  });

  const grouped = new Map<string, DepositRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.appointmentId);
    if (list) list.push(row);
    else grouped.set(row.appointmentId, [row]);
  }

  for (const [appointmentId, group] of grouped) {
    const effective = pickEffectiveDeposit(group);
    if (effective) byAppointment.set(appointmentId, effective);
  }

  return byAppointment;
}
