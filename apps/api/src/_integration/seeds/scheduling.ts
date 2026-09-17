/**
 * Scheduling-domain seed helpers (blocked-time / time-off / shifts).
 *
 * Insert real rows for the scheduling integration spec so the feature services
 * + real SQL see genuine data. These build on the shared primitives in
 * ../harness.ts (seedOrganization / seedUser / seedMember / seedPractitioner)
 * but live here so harness.ts stays domain-agnostic.
 *
 * Tables touched: `blocked_time_type`, `blocked_time`,
 * `blocked_time_practitioner`, `time_off`. Shift rows are written exclusively
 * through the endpoints under test (PUT /shifts/weekly), so no shift seed lives
 * here.
 */
import { randomUUID } from 'node:crypto';
import {
  blockedTime,
  blockedTimePractitioner,
  blockedTimeType,
  db,
  timeOff,
} from '@borradh-workspace/database';

/**
 * Insert a `blocked_time_type` scoped to an org. Returns its id. `name` is
 * unique per org (`blocked_time_type_org_name_unique`), so a random suffix
 * keeps repeated seeds from colliding. `durationMinutes` must satisfy the Zod
 * rule int().multipleOf(5).min(5).max(535).
 */
export async function seedBlockedTimeType(input: {
  organizationId: string;
  name?: string;
  durationMinutes?: number;
  paid?: boolean;
}): Promise<string> {
  const id = `btt_${randomUUID()}`;
  await db.insert(blockedTimeType).values({
    id,
    organizationId: input.organizationId,
    name: input.name ?? `Type ${id}`,
    durationMinutes: input.durationMinutes ?? 30,
    paid: input.paid ?? false,
  });
  return id;
}

/**
 * Insert a one-off `blocked_time` scoped to an org, plus optional
 * practitioner-join rows. Returns the series id.
 *
 * `createdById` (→ user.id) is NOT NULL with onDelete 'restrict', so callers
 * must pass a real user in the org. `startDate`/`endDate` are timestamptz and
 * default to a fixed future one-hour window so overlap queries are
 * deterministic. Empty `practitionerIds` (the default) = an org-wide block.
 */
export async function seedBlockedTime(input: {
  organizationId: string;
  createdById: string;
  title?: string;
  startDate?: Date;
  endDate?: Date;
  practitionerIds?: string[];
  blockedTimeTypeId?: string;
  paid?: boolean;
}): Promise<string> {
  const id = `bt_${randomUUID()}`;
  const start = input.startDate ?? new Date('2030-06-03T09:00:00.000Z');
  const end = input.endDate ?? new Date('2030-06-03T10:00:00.000Z');
  await db.insert(blockedTime).values({
    id,
    organizationId: input.organizationId,
    createdById: input.createdById,
    blockedTimeTypeId: input.blockedTimeTypeId ?? null,
    title: input.title ?? 'Seeded Block',
    startDate: start,
    endDate: end,
    paid: input.paid ?? false,
  });
  const practitionerIds = input.practitionerIds ?? [];
  if (practitionerIds.length > 0) {
    await db.insert(blockedTimePractitioner).values(
      practitionerIds.map((practitionerId) => ({
        blockedTimeId: id,
        practitionerId,
      }))
    );
  }
  return id;
}

/**
 * Insert a one-off `time_off` row scoped to an org + practitioner. Returns its
 * id. `practitionerId` and `createdById` are NOT NULL; `startDate`/`endDate`
 * are timestamptz defaulting to a fixed future one-day window.
 */
export async function seedTimeOff(input: {
  organizationId: string;
  practitionerId: string;
  createdById: string;
  type?: (typeof timeOff.$inferInsert)['type'];
  startDate?: Date;
  endDate?: Date;
}): Promise<string> {
  const id = `to_${randomUUID()}`;
  const start = input.startDate ?? new Date('2030-06-10T00:00:00.000Z');
  const end = input.endDate ?? new Date('2030-06-11T00:00:00.000Z');
  await db.insert(timeOff).values({
    id,
    organizationId: input.organizationId,
    practitionerId: input.practitionerId,
    createdById: input.createdById,
    type: input.type ?? 'annual_leave',
    startDate: start,
    endDate: end,
  });
  return id;
}
