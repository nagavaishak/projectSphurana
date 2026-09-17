/**
 * Phase 7 §7f — resource-scheduling referential integrity.
 *
 * Every assertion here is a property of the DATABASE's foreign keys and
 * indexes, exercised with raw drizzle writes against the real migrated schema.
 * No feature service is involved: the service layer is expected to turn most of
 * these into friendly 409s BEFORE the DB is reached, and this file is what
 * guarantees that even when it doesn't, the data cannot end up wrong.
 *
 * Behaviour locked here:
 *  - `appointment_resource.appointment_id` CASCADEs. Deleting an appointment
 *    releases its rooms; no allocation can outlive the booking it belongs to,
 *    which is the invariant that lets the availability query skip a join back
 *    to `appointment.status`.
 *  - `appointment_resource.resource_id` RESTRICTs. A room with live allocations
 *    must be DEACTIVATED, not deleted — deleting it would silently drop the
 *    holds and free every slot it was blocking.
 *  - `resource.category_id` and `service_resource_requirement.category_id`
 *    CASCADE from `resource_category`; requirements and eligibility CASCADE
 *    from `organization_service`. Deleting a service leaves no orphan
 *    requirement that would gate bookings for a service that no longer exists.
 *  - `resource.location_id` is SET NULL, not CASCADE. Closing a branch must not
 *    delete the rooms in it — `location_id IS NULL` already means "available at
 *    every location", so the resource degrades gracefully instead of vanishing.
 *  - Deleting an organization CASCADEs all five resource tables clean, in an
 *    order that does not trip the RESTRICT above.
 *  - `resource_category_org_name_unique` is PARTIAL
 *    (`WHERE deleted_at IS NULL`): a duplicate live name is rejected, but the
 *    name of a SOFT-DELETED category is free to reuse. That partiality is the
 *    whole reason the index exists in that form.
 */
import { randomUUID } from 'node:crypto';
import {
  appointmentResource,
  db,
  organization,
  organizationLocation,
  organizationService,
  resource,
  resourceCategory,
} from '@borradh-workspace/database';
import { eq, sql } from 'drizzle-orm';
import {
  seedAppointment,
  seedLead,
  seedOrganization,
  seedService,
  seedUser,
} from './harness.js';
import {
  capturePgError,
  seedAllocation,
  seedEligibility,
  seedRequirement,
  seedResource,
  seedResourceCategory,
} from './seeds/resources.js';

/** SQLSTATE 23503 — foreign_key_violation. */
const FK_VIOLATION = '23503';
/** SQLSTATE 23505 — unique_violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * Fixture literals rebased onto a near-future anchor computed once from the
 * real clock, so no absolute date in this file can time-bomb. Intervals are
 * preserved exactly. Same trick as appointment-double-booking.int-spec.ts.
 */
const FIXTURE_EPOCH_MS = Date.UTC(2026, 4, 1); // earliest literal: 2026-05-01
const FUTURE_ANCHOR_MS = (() => {
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + 21);
  return base.getTime();
})();
const at = (iso: string) =>
  new Date(new Date(iso).getTime() - FIXTURE_EPOCH_MS + FUTURE_ANCHOR_MS);

/** Insert a real `organization_location` (NOT NULL: address1 / city / country). */
async function seedLocation(organizationId: string): Promise<string> {
  const id = `loc_${randomUUID()}`;
  await db.insert(organizationLocation).values({
    id,
    organizationId,
    name: 'Main Clinic',
    addressLine1: '1 Test Street',
    city: 'Dublin',
    country: 'ie',
    isPrimary: true,
  });
  return id;
}

/** `SELECT count(*)` against one table, filtered by one column. */
async function countWhere(
  table: string,
  column: string,
  value: string
): Promise<number> {
  const rows = await db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM ${sql.identifier(table)}
        WHERE ${sql.identifier(column)} = ${value}`
  );
  return Number(rows[0].count);
}

describe('Phase 7 §7f — resource referential integrity', () => {
  it('deleting an appointment CASCADEs its allocations away', async () => {
    const organizationId = await seedOrganization();
    const assignee = await seedUser();
    const leadId = await seedLead({ organizationId });
    const categoryId = await seedResourceCategory({ organizationId });
    const resourceId = await seedResource({ organizationId, categoryId });
    const appointmentId = await seedAppointment({
      organizationId,
      assignedToId: assignee.id,
      leadId,
    });
    const allocationId = await seedAllocation({
      organizationId,
      appointmentId,
      resourceId,
      startDate: at('2026-05-01T10:00:00.000Z'),
      endDate: at('2026-05-01T11:00:00.000Z'),
    });

    expect(await countWhere('appointment_resource', 'id', allocationId)).toBe(
      1
    );

    await db.execute(sql`DELETE FROM appointment WHERE id = ${appointmentId}`);

    // The hold is gone, so the room is free again — no manual release needed.
    expect(await countWhere('appointment_resource', 'id', allocationId)).toBe(
      0
    );
    // …and the room itself survived: only the allocation cascaded.
    expect(await countWhere('resource', 'id', resourceId)).toBe(1);
  });

  it('hard-deleting a resource that holds allocations is RESTRICTed', async () => {
    const organizationId = await seedOrganization();
    const assignee = await seedUser();
    const leadId = await seedLead({ organizationId });
    const categoryId = await seedResourceCategory({ organizationId });
    const resourceId = await seedResource({ organizationId, categoryId });
    const appointmentId = await seedAppointment({
      organizationId,
      assignedToId: assignee.id,
      leadId,
    });
    await seedAllocation({
      organizationId,
      appointmentId,
      resourceId,
      startDate: at('2026-05-02T10:00:00.000Z'),
      endDate: at('2026-05-02T11:00:00.000Z'),
    });

    // Named constraint, not just "some error": a CASCADE here would silently
    // free every slot the room was blocking and nobody would ever know.
    const err = await capturePgError(() =>
      db.delete(resource).where(eq(resource.id, resourceId))
    );
    expect(err.code).toBe(FK_VIOLATION);
    expect(err.message).toMatch(
      /appointment_resource_resource_id_resource_id_fk/
    );

    // The refusal left everything intact.
    expect(await countWhere('resource', 'id', resourceId)).toBe(1);
    expect(
      await countWhere('appointment_resource', 'resource_id', resourceId)
    ).toBe(1);

    // The supported path — release the allocation first — then works.
    await db
      .delete(appointmentResource)
      .where(eq(appointmentResource.resourceId, resourceId));
    await db.delete(resource).where(eq(resource.id, resourceId));
    expect(await countWhere('resource', 'id', resourceId)).toBe(0);
  });

  it('deleting a resource_category CASCADEs its requirements and its resources', async () => {
    const organizationId = await seedOrganization();
    const serviceId = await seedService({ organizationId });
    const categoryId = await seedResourceCategory({ organizationId });
    const resourceId = await seedResource({ organizationId, categoryId });
    const requirementId = await seedRequirement({
      organizationId,
      serviceId,
      categoryId,
    });

    await db
      .delete(resourceCategory)
      .where(eq(resourceCategory.id, categoryId));

    expect(
      await countWhere('service_resource_requirement', 'id', requirementId)
    ).toBe(0);
    // `resource.category_id` is CASCADE too — a room cannot exist without the
    // category that types it.
    expect(await countWhere('resource', 'id', resourceId)).toBe(0);
    // The service is untouched: only its room requirement disappeared.
    expect(await countWhere('organization_service', 'id', serviceId)).toBe(1);
  });

  it('deleting an organization_service CASCADEs its requirements AND eligibility', async () => {
    const organizationId = await seedOrganization();
    const serviceId = await seedService({ organizationId });
    const categoryId = await seedResourceCategory({ organizationId });
    const resourceId = await seedResource({ organizationId, categoryId });
    const requirementId = await seedRequirement({
      organizationId,
      serviceId,
      categoryId,
    });
    const eligibilityId = await seedEligibility({
      organizationId,
      serviceId,
      resourceId,
    });

    await db
      .delete(organizationService)
      .where(eq(organizationService.id, serviceId));

    // An orphan requirement would gate bookings for a service that no longer
    // exists; an orphan eligibility would narrow a requirement that is gone.
    expect(
      await countWhere('service_resource_requirement', 'id', requirementId)
    ).toBe(0);
    expect(
      await countWhere('service_resource_eligibility', 'id', eligibilityId)
    ).toBe(0);
    // The room and its category outlive the service — they belong to the org.
    expect(await countWhere('resource', 'id', resourceId)).toBe(1);
    expect(await countWhere('resource_category', 'id', categoryId)).toBe(1);
  });

  it('deleting an organization_location SETs resource.location_id NULL and keeps the resource', async () => {
    const organizationId = await seedOrganization();
    const locationId = await seedLocation(organizationId);
    const categoryId = await seedResourceCategory({ organizationId });
    const resourceId = await seedResource({
      organizationId,
      categoryId,
      locationId,
    });

    const before = await db
      .select({ locationId: resource.locationId })
      .from(resource)
      .where(eq(resource.id, resourceId));
    expect(before[0].locationId).toBe(locationId);

    await db
      .delete(organizationLocation)
      .where(eq(organizationLocation.id, locationId));

    const after = await db
      .select({ id: resource.id, locationId: resource.locationId })
      .from(resource)
      .where(eq(resource.id, resourceId));

    // Closing a branch must not delete the rooms in it. NULL already means
    // "available at every location", so the row degrades gracefully.
    expect(after).toHaveLength(1);
    expect(after[0].locationId).toBeNull();
  });

  it('deleting an organization CASCADEs all five resource tables clean', async () => {
    const organizationId = await seedOrganization();
    const assignee = await seedUser();
    const leadId = await seedLead({ organizationId });
    const serviceId = await seedService({ organizationId });
    const categoryId = await seedResourceCategory({ organizationId });
    const resourceId = await seedResource({ organizationId, categoryId });
    await seedRequirement({ organizationId, serviceId, categoryId });
    await seedEligibility({ organizationId, serviceId, resourceId });
    const appointmentId = await seedAppointment({
      organizationId,
      assignedToId: assignee.id,
      leadId,
    });
    await seedAllocation({
      organizationId,
      appointmentId,
      resourceId,
      startDate: at('2026-05-03T10:00:00.000Z'),
      endDate: at('2026-05-03T11:00:00.000Z'),
    });

    // NOTE: this exercises a real ordering hazard. The org cascade reaches both
    // `resource` (CASCADE) and `appointment_resource` (CASCADE), while
    // `appointment_resource.resource_id` is RESTRICT — so if the resource rows
    // were removed BEFORE their allocations, the delete would abort. Asserted
    // here so a future FK re-order cannot make deleting an org impossible.
    await db.delete(organization).where(eq(organization.id, organizationId));

    for (const table of [
      'resource_category',
      'resource',
      'service_resource_requirement',
      'service_resource_eligibility',
      'appointment_resource',
    ]) {
      expect(await countWhere(table, 'organization_id', organizationId)).toBe(
        0
      );
    }
  });

  describe('resource_category_org_name_unique (PARTIAL index)', () => {
    it('rejects a duplicate LIVE name in the same org', async () => {
      const organizationId = await seedOrganization();
      await seedResourceCategory({ organizationId, name: 'Treatment Rooms' });

      const err = await capturePgError(() =>
        seedResourceCategory({ organizationId, name: 'Treatment Rooms' })
      );
      expect(err.code).toBe(UNIQUE_VIOLATION);
      expect(err.message).toMatch(/resource_category_org_name_unique/);
    });

    it('ALLOWS reusing the name of a SOFT-DELETED category', async () => {
      const organizationId = await seedOrganization();
      const originalId = await seedResourceCategory({
        organizationId,
        name: 'Laser Bays',
      });

      // Soft delete — the row stays in the table but leaves the partial index.
      await db
        .update(resourceCategory)
        .set({ deletedAt: new Date() })
        .where(eq(resourceCategory.id, originalId));

      const reusedId = await seedResourceCategory({
        organizationId,
        name: 'Laser Bays',
      });
      expect(reusedId).not.toBe(originalId);

      // Both rows coexist: one archived, one live.
      const rows = await db
        .select({
          id: resourceCategory.id,
          deletedAt: resourceCategory.deletedAt,
        })
        .from(resourceCategory)
        .where(eq(resourceCategory.organizationId, organizationId));
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => r.deletedAt === null)).toHaveLength(1);

      // …and the live one is once again exclusive.
      const err = await capturePgError(() =>
        seedResourceCategory({ organizationId, name: 'Laser Bays' })
      );
      expect(err.code).toBe(UNIQUE_VIOLATION);
      expect(err.message).toMatch(/resource_category_org_name_unique/);
    });

    it('scopes uniqueness to the ORG — two clinics may both have "Rooms"', async () => {
      const orgA = await seedOrganization();
      const orgB = await seedOrganization();

      const a = await seedResourceCategory({
        organizationId: orgA,
        name: 'Rooms',
      });
      const b = await seedResourceCategory({
        organizationId: orgB,
        name: 'Rooms',
      });

      expect(a).not.toBe(b);
      expect(await countWhere('resource_category', 'id', a)).toBe(1);
      expect(await countWhere('resource_category', 'id', b)).toBe(1);
    });
  });
});
