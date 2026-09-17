import { organization, shift } from '@borradh-workspace/database';
import { and, eq, isNull } from 'drizzle-orm';
import type { DbConnection } from '../../shared/index.js';

/**
 * Fallback weekly pattern (day 0=Sun..6=Sat, minutes from midnight) used when
 * an org has no open business hours to mirror: a standard 9–5, Mon–Fri week.
 */
const DEFAULT_WEEKLY_SHIFT: Record<number, { from: number; to: number }> = {
  1: { from: 540, to: 1020 },
  2: { from: 540, to: 1020 },
  3: { from: 540, to: 1020 },
  4: { from: 540, to: 1020 },
  5: { from: 540, to: 1020 },
};

function hasOpenDay(
  hours: Record<number, { from: number; to: number }>
): boolean {
  return Object.values(hours).some((h) => h && h.to > h.from);
}

/**
 * Seed a new practitioner's weekly shift pattern from the org's business hours
 * — which hold the opening hours scraped during onboarding — falling back to a
 * standard 9–5 Mon–Fri week when the org has no open days configured. Closed
 * days (from >= to) are skipped so the practitioner isn't rostered on them.
 *
 * Idempotent: no-op if the practitioner already has any weekly pattern rows, so
 * onboarding retries or re-runs never double-book a staff member.
 */
export async function seedDefaultWeeklyShifts(
  db: DbConnection,
  {
    organizationId,
    practitionerId,
  }: { organizationId: string; practitionerId: string }
): Promise<void> {
  const existing = await db
    .select({ id: shift.id })
    .from(shift)
    .where(
      and(
        eq(shift.organizationId, organizationId),
        eq(shift.practitionerId, practitionerId),
        isNull(shift.date)
      )
    )
    .limit(1);
  if (existing.length > 0) return;

  const org = await db.query.organization.findFirst({
    where: eq(organization.id, organizationId),
    columns: { businessHours: true },
  });

  const source =
    org?.businessHours && hasOpenDay(org.businessHours)
      ? org.businessHours
      : DEFAULT_WEEKLY_SHIFT;

  const values = Object.entries(source)
    .map(([day, h]) => ({ dayOfWeek: Number(day), from: h.from, to: h.to }))
    .filter((d) => d.to > d.from)
    .map((d) => ({
      organizationId,
      practitionerId,
      locationId: null,
      dayOfWeek: d.dayOfWeek,
      date: null,
      startMinutes: d.from,
      endMinutes: d.to,
      isOff: false,
    }));

  if (values.length === 0) return;

  await db.insert(shift).values(values);
}
