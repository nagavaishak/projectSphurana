/**
 * Phase 7 §7b — resource RLS policies + `app_public` column grants.
 *
 * The highest-value file in the resource suite, because its failure mode is
 * SILENT. A missing grant surfaces as `permission denied`, which the booking
 * service swallows into an EMPTY-SLOTS / "no requirements found" result — so
 * resource gating quietly switches OFF and rooms double-book with no error
 * anywhere, in any log. Nothing above the database can detect that; only
 * connecting as the real roles against real policies can.
 *
 * Everything here runs as the REAL Postgres roles (`app_authenticated`,
 * `app_public`) inside a transaction that sets `app.current_org_id` exactly the
 * way `withOrgScope` / `withPublicOrgScope` do (`set_config(..., is_local =
 * true)`). No feature service is involved — this is the database's own
 * behaviour under test.
 *
 * Behaviour locked here:
 *  - org_isolation READ: scoped to org A, all five resource tables
 *    (`resource_category`, `resource`, `service_resource_requirement`,
 *    `service_resource_eligibility`, `appointment_resource`) return org A's
 *    rows and NONE of org B's, even though both orgs' rows share the table.
 *  - org_isolation WITH CHECK: scoped to org A, an INSERT carrying org B's
 *    `organization_id` is REJECTED on all five tables. A tampered payload
 *    cannot write into a neighbouring clinic.
 *  - `app_public` CAN read the columns the slot resolver needs on `resource`
 *    (id, organization_id, category_id, location_id, capacity, working_hours,
 *    sort_order, is_active, deleted_at) — the grant is real, so gating actually
 *    computes rather than collapsing to "no rooms configured".
 *  - `app_public` CANNOT read `resource.name` / `.specs` / `.photo`. The column
 *    narrowing in migration 0148 is real, not aspirational: "Room 2 — back
 *    corridor" / "Lumenis M22" is clinic-internal and never reaches an
 *    anonymous booking widget.
 *  - The granted column SET is asserted against `information_schema` so a
 *    column added to `resource` / `appointment_resource` later defaults to NOT
 *    being public — you have to come here and say so on purpose.
 *  - `app_public` CAN INSERT into `appointment_resource` (the open booking flow
 *    creates the appointment AND its allocations in one transaction), and that
 *    INSERT is still pinned to the org scope by the policy's WITH CHECK.
 *  - FAIL-CLOSED: with NO org scope set, all five tables return ZERO rows for
 *    both roles. `current_setting('app.current_org_id', true)` is NULL, the
 *    comparison is NULL, and NULL is not true — never a cross-org leak.
 */
import { db } from '@borradh-workspace/database';
import { sql } from 'drizzle-orm';
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

/**
 * SQLSTATE 42501 — insufficient_privilege. Postgres uses it for BOTH an RLS
 * WITH CHECK violation and a missing column/table grant, so every assertion
 * below pairs it with a message match that tells the two apart.
 */
const INSUFFICIENT_PRIVILEGE = '42501';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type RlsRole = 'app_authenticated' | 'app_public';

/**
 * Run `fn` as a real least-privilege Postgres role, optionally inside an org
 * scope — the exact mechanism `withOrgScope` / `withPublicOrgScope` use
 * (`set_config(name, value, is_local => true)`, i.e. SET LOCAL, so it is
 * transaction-scoped and survives PgBouncer transaction pooling).
 *
 * `role` is switched via `set_config('role', …, true)` rather than
 * `SET LOCAL ROLE`, so the value is a bind parameter and the transaction
 * unwinds the role at COMMIT/ROLLBACK either way.
 *
 * Pass `organizationId: null` to model "no scope established" — the fail-closed
 * case. The seeding around these calls runs as the owner (`db` directly), which
 * is how the rows under test get into the table at all: the owner is not
 * subject to its own policies.
 */
async function asRole<T>(
  role: RlsRole,
  organizationId: string | null,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('role', ${role}, true)`);
    if (organizationId !== null) {
      await tx.execute(
        sql`SELECT set_config('app.current_org_id', ${organizationId}, true)`
      );
    }
    return fn(tx);
  });
}

/** Everything one org needs to have exactly one row in each of the 5 tables. */
async function seedResourceWorld() {
  const organizationId = await seedOrganization();
  const assignee = await seedUser();
  const leadId = await seedLead({ organizationId });
  const serviceId = await seedService({ organizationId });
  const categoryId = await seedResourceCategory({ organizationId });
  const resourceId = await seedResource({
    organizationId,
    categoryId,
    name: 'Room 2 — back corridor',
    specs: { Device: 'Lumenis M22' },
    photo: 'https://example.com/room-2.jpg',
    capacity: 1,
  });
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
  const appointmentId = await seedAppointment({
    organizationId,
    assignedToId: assignee.id,
    leadId,
  });
  const allocationId = await seedAllocation({
    organizationId,
    appointmentId,
    resourceId,
    startDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    endDate: new Date(Date.now() + 25 * 60 * 60 * 1000),
  });

  return {
    organizationId,
    serviceId,
    categoryId,
    resourceId,
    requirementId,
    eligibilityId,
    appointmentId,
    allocationId,
  };
}

type World = Awaited<ReturnType<typeof seedResourceWorld>>;

/** The five tables under org_isolation, paired with the id each world holds. */
const RESOURCE_TABLES = [
  { table: 'resource_category', idOf: (w: World) => w.categoryId },
  { table: 'resource', idOf: (w: World) => w.resourceId },
  {
    table: 'service_resource_requirement',
    idOf: (w: World) => w.requirementId,
  },
  {
    table: 'service_resource_eligibility',
    idOf: (w: World) => w.eligibilityId,
  },
  { table: 'appointment_resource', idOf: (w: World) => w.allocationId },
] as const;

/**
 * The columns migration 0148 grants `app_public` on `resource` — deliberately
 * ONLY what answers "is an eligible resource free at 14:00?". name /
 * description / photo / specs are withheld.
 *
 * `sort_order` IS in the list and must be: Postgres column privileges cover
 * every REFERENCED column, including one that appears only in ORDER BY, and the
 * auto-assignment engine orders candidate rooms by it. Ordering by an ungranted
 * column would raise `permission denied` inside the public booking widget —
 * which the booking service swallows into an empty-slots result. Alphabetical,
 * to match `ORDER BY column_name`.
 */
const PUBLIC_RESOURCE_COLUMNS = [
  'capacity',
  'category_id',
  'deleted_at',
  'id',
  'is_active',
  'location_id',
  'organization_id',
  'sort_order',
  'working_hours',
];

/** The columns migration 0148 grants `app_public` on `appointment_resource`. */
const PUBLIC_ALLOCATION_COLUMNS = [
  'allow_overlap',
  'appointment_id',
  'end_date',
  'id',
  'organization_id',
  'resource_id',
  'start_date',
  'turnaround_minutes',
];

describe('Phase 7 §7b — resource RLS + app_public grants', () => {
  describe('org_isolation — reads', () => {
    it('org A reads only its own rows in all five resource tables', async () => {
      const orgA = await seedResourceWorld();
      const orgB = await seedResourceWorld();

      for (const { table, idOf } of RESOURCE_TABLES) {
        const rows = await asRole(
          'app_authenticated',
          orgA.organizationId,
          (tx) =>
            tx.execute<{ id: string }>(
              sql`SELECT id FROM ${sql.identifier(table)}`
            )
        );
        const ids = rows.map((r) => r.id);

        // Exactly org A's single row — not "at least" it, so a policy that
        // accidentally matched everything would fail here rather than pass.
        expect(ids).toEqual([idOf(orgA)]);
        expect(ids).not.toContain(idOf(orgB));
      }
    });

    it('org A cannot reach an org-B row even by asking for it BY ID', async () => {
      const orgA = await seedResourceWorld();
      const orgB = await seedResourceWorld();

      for (const { table, idOf } of RESOURCE_TABLES) {
        const rows = await asRole(
          'app_authenticated',
          orgA.organizationId,
          (tx) =>
            tx.execute<{ id: string }>(
              sql`SELECT id FROM ${sql.identifier(table)} WHERE id = ${idOf(orgB)}`
            )
        );
        expect(rows).toHaveLength(0);
      }
    });
  });

  describe('org_isolation — WITH CHECK on writes', () => {
    it('org A cannot INSERT a row carrying the organization_id of org B', async () => {
      const orgA = await seedResourceWorld();
      const orgB = await seedResourceWorld();

      // Every payload is otherwise VALID for org B (real FK targets), so the
      // only thing that can reject it is the policy's WITH CHECK — not a
      // dangling foreign key.
      const attempts: { table: string; run: (tx: Tx) => Promise<unknown> }[] = [
        {
          table: 'resource_category',
          run: (tx) =>
            tx.execute(
              sql`INSERT INTO resource_category (id, organization_id, name)
                  VALUES (${`rcat_x_${orgA.categoryId}`}, ${orgB.organizationId}, 'Smuggled category')`
            ),
        },
        {
          table: 'resource',
          run: (tx) =>
            tx.execute(
              sql`INSERT INTO resource (id, organization_id, category_id, name)
                  VALUES (${`res_x_${orgA.resourceId}`}, ${orgB.organizationId}, ${orgB.categoryId}, 'Smuggled room')`
            ),
        },
        {
          table: 'service_resource_requirement',
          run: (tx) =>
            tx.execute(
              sql`INSERT INTO service_resource_requirement (id, organization_id, service_id, category_id)
                  VALUES (${`rreq_x_${orgA.requirementId}`}, ${orgB.organizationId}, ${orgB.serviceId}, ${orgB.categoryId})`
            ),
        },
        {
          table: 'service_resource_eligibility',
          run: (tx) =>
            tx.execute(
              sql`INSERT INTO service_resource_eligibility (id, organization_id, service_id, resource_id)
                  VALUES (${`relig_x_${orgA.eligibilityId}`}, ${orgB.organizationId}, ${orgB.serviceId}, ${orgB.resourceId})`
            ),
        },
        {
          table: 'appointment_resource',
          run: (tx) =>
            tx.execute(
              sql`INSERT INTO appointment_resource
                    (id, organization_id, appointment_id, resource_id, start_date, end_date, allow_overlap)
                  VALUES (${`ares_x_${orgA.allocationId}`}, ${orgB.organizationId}, ${orgB.appointmentId}, ${orgB.resourceId},
                          now() + interval '3 days', now() + interval '3 days 1 hour', true)`
            ),
        },
      ];

      for (const attempt of attempts) {
        const err = await capturePgError(() =>
          asRole('app_authenticated', orgA.organizationId, attempt.run)
        );
        expect(err.code).toBe(INSUFFICIENT_PRIVILEGE);
        // The RLS wording, not merely "insufficient privilege" — a missing
        // GRANT shares the SQLSTATE and would otherwise satisfy this.
        expect(err.message).toMatch(/row-level security policy/);
        expect(err.message).toContain(attempt.table);
      }

      // And nothing landed: org B's tables are untouched by org A's attempts.
      for (const { table, idOf } of RESOURCE_TABLES) {
        const rows = await asRole(
          'app_authenticated',
          orgB.organizationId,
          (tx) =>
            tx.execute<{ id: string }>(
              sql`SELECT id FROM ${sql.identifier(table)}`
            )
        );
        expect(rows.map((r) => r.id)).toEqual([idOf(orgB)]);
      }
    });
  });

  describe('app_public column grants on `resource`', () => {
    it('CAN select every column the slot resolver needs', async () => {
      const orgA = await seedResourceWorld();

      // This is the read that decides whether a room is offerable. If it ever
      // raises `permission denied`, the booking service turns that into an
      // empty slot list and gating silently disappears.
      const rows = await asRole('app_public', orgA.organizationId, (tx) =>
        tx.execute<{
          id: string;
          organization_id: string;
          category_id: string;
          location_id: string | null;
          capacity: number;
          working_hours: unknown;
          is_active: boolean;
          deleted_at: Date | null;
        }>(
          sql`SELECT id, organization_id, category_id, location_id,
                     capacity, working_hours, is_active, deleted_at
              FROM resource`
        )
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(orgA.resourceId);
      expect(rows[0].organization_id).toBe(orgA.organizationId);
      expect(rows[0].category_id).toBe(orgA.categoryId);
      expect(rows[0].capacity).toBe(1);
      expect(rows[0].is_active).toBe(true);
      expect(rows[0].deleted_at).toBeNull();
    });

    it.each(['name', 'specs', 'photo'])(
      'is DENIED selecting resource.%s',
      async (column) => {
        const orgA = await seedResourceWorld();

        // Note the failure shape: `permission denied`, an ERROR — NOT zero
        // rows. That distinction is the whole reason this is testable at all.
        const err = await capturePgError(() =>
          asRole('app_public', orgA.organizationId, (tx) =>
            tx.execute(
              sql`SELECT ${sql.identifier(column)} FROM resource WHERE id = ${orgA.resourceId}`
            )
          )
        );
        expect(err.code).toBe(INSUFFICIENT_PRIVILEGE);
        expect(err.message).toMatch(/permission denied/i);
        expect(err.message).toContain('resource');
      }
    );

    it('is DENIED a blanket SELECT * on resource', async () => {
      const orgA = await seedResourceWorld();

      // The most likely way a resolver regresses: someone swaps an explicit
      // column list for `select()` / `SELECT *`.
      const err = await capturePgError(() =>
        asRole('app_public', orgA.organizationId, (tx) =>
          tx.execute(sql`SELECT * FROM resource`)
        )
      );
      expect(err.code).toBe(INSUFFICIENT_PRIVILEGE);
      expect(err.message).toMatch(/permission denied/i);
    });

    it('grants EXACTLY the documented column set (a new column is private by default)', async () => {
      const granted = await db.execute<{ column_name: string }>(
        sql`SELECT column_name
            FROM information_schema.column_privileges
            WHERE grantee = 'app_public'
              AND table_name = 'resource'
              AND privilege_type = 'SELECT'
            ORDER BY column_name`
      );
      expect(granted.map((r) => r.column_name)).toEqual(
        PUBLIC_RESOURCE_COLUMNS
      );

      const grantedAlloc = await db.execute<{ column_name: string }>(
        sql`SELECT column_name
            FROM information_schema.column_privileges
            WHERE grantee = 'app_public'
              AND table_name = 'appointment_resource'
              AND privilege_type = 'SELECT'
            ORDER BY column_name`
      );
      expect(grantedAlloc.map((r) => r.column_name)).toEqual(
        PUBLIC_ALLOCATION_COLUMNS
      );
    });
  });

  describe('app_public reads on the join + busy tables', () => {
    it('CAN read requirements, eligibility, categories and busy ranges', async () => {
      const orgA = await seedResourceWorld();

      const scope = <T>(fn: (tx: Tx) => Promise<T>) =>
        asRole('app_public', orgA.organizationId, fn);

      const requirements = await scope((tx) =>
        tx.execute<{ id: string; category_id: string }>(
          sql`SELECT id, category_id FROM service_resource_requirement WHERE service_id = ${orgA.serviceId}`
        )
      );
      const eligibility = await scope((tx) =>
        tx.execute<{ id: string; resource_id: string }>(
          sql`SELECT id, resource_id FROM service_resource_eligibility WHERE service_id = ${orgA.serviceId}`
        )
      );
      const categories = await scope((tx) =>
        tx.execute<{ id: string }>(sql`SELECT id FROM resource_category`)
      );
      const allocations = await scope((tx) =>
        tx.execute<{ id: string; resource_id: string }>(
          sql`SELECT id, resource_id, start_date, end_date, allow_overlap
              FROM appointment_resource`
        )
      );

      // Requirements being unreadable is the specific bug that turns gating
      // off: "no requirements found" reads exactly like "this service needs no
      // room", and the booking sails through.
      expect(requirements.map((r) => r.id)).toEqual([orgA.requirementId]);
      expect(requirements[0].category_id).toBe(orgA.categoryId);
      expect(eligibility.map((r) => r.id)).toEqual([orgA.eligibilityId]);
      expect(eligibility[0].resource_id).toBe(orgA.resourceId);
      expect(categories.map((r) => r.id)).toEqual([orgA.categoryId]);
      expect(allocations.map((r) => r.id)).toEqual([orgA.allocationId]);
      expect(allocations[0].resource_id).toBe(orgA.resourceId);
    });
  });

  describe('app_public writes', () => {
    it('CAN INSERT an allocation inside its org scope', async () => {
      const orgA = await seedResourceWorld();
      const assignee = await seedUser();
      const otherAppointmentId = await seedAppointment({
        organizationId: orgA.organizationId,
        assignedToId: assignee.id,
        title: 'Public booking',
      });
      const allocationId = `ares_public_${otherAppointmentId}`;

      await asRole('app_public', orgA.organizationId, (tx) =>
        tx.execute(
          sql`INSERT INTO appointment_resource
                (id, organization_id, appointment_id, resource_id, start_date, end_date)
              VALUES (${allocationId}, ${orgA.organizationId}, ${otherAppointmentId}, ${orgA.resourceId},
                      now() + interval '10 days', now() + interval '10 days 1 hour')`
        )
      );

      const landed = await db.execute<{
        id: string;
        organization_id: string;
        source: string;
      }>(
        sql`SELECT id, organization_id, source::text AS source
            FROM appointment_resource WHERE id = ${allocationId}`
      );
      expect(landed).toHaveLength(1);
      expect(landed[0].organization_id).toBe(orgA.organizationId);
      // `source` defaults to 'auto' — an anonymous booker never picks a room.
      expect(landed[0].source).toBe('auto');
    });

    it('CANNOT INSERT an allocation for another org, even with valid FKs', async () => {
      const orgA = await seedResourceWorld();
      const orgB = await seedResourceWorld();

      const err = await capturePgError(() =>
        asRole('app_public', orgA.organizationId, (tx) =>
          tx.execute(
            sql`INSERT INTO appointment_resource
                  (id, organization_id, appointment_id, resource_id, start_date, end_date, allow_overlap)
                VALUES (${`ares_leak_${orgB.appointmentId}`}, ${orgB.organizationId}, ${orgB.appointmentId}, ${orgB.resourceId},
                        now() + interval '11 days', now() + interval '11 days 1 hour', true)`
          )
        )
      );
      expect(err.code).toBe(INSUFFICIENT_PRIVILEGE);
      expect(err.message).toMatch(/row-level security policy/);
      expect(err.message).toContain('appointment_resource');
    });
  });

  describe('fail-closed outside any org scope', () => {
    it('all five tables return ZERO rows for app_authenticated', async () => {
      const orgA = await seedResourceWorld();
      const orgB = await seedResourceWorld();

      for (const { table, idOf } of RESOURCE_TABLES) {
        const rows = await asRole('app_authenticated', null, (tx) =>
          tx.execute<{ id: string }>(
            sql`SELECT id FROM ${sql.identifier(table)}`
          )
        );
        // NOT "org A's rows" and NOT "everything" — nothing. An unset
        // `app.current_org_id` makes the predicate NULL, and NULL is not true.
        expect(rows).toHaveLength(0);
        expect(rows.map((r) => r.id)).not.toContain(idOf(orgA));
        expect(rows.map((r) => r.id)).not.toContain(idOf(orgB));
      }
    });

    it('resource + allocations return ZERO rows for app_public', async () => {
      const orgA = await seedResourceWorld();

      const unscoped = <T>(fn: (tx: Tx) => Promise<T>) =>
        asRole('app_public', null, fn);

      const resources = await unscoped((tx) =>
        tx.execute<{ id: string }>(sql`SELECT id FROM resource`)
      );
      const allocations = await unscoped((tx) =>
        tx.execute<{ id: string }>(sql`SELECT id FROM appointment_resource`)
      );
      const requirements = await unscoped((tx) =>
        tx.execute<{ id: string }>(
          sql`SELECT id FROM service_resource_requirement`
        )
      );

      expect(resources).toHaveLength(0);
      expect(allocations).toHaveLength(0);
      expect(requirements).toHaveLength(0);
      // Sanity: the rows DO exist — the emptiness above is the policy, not an
      // empty database.
      const owned = await db.execute<{ id: string }>(
        sql`SELECT id FROM resource WHERE id = ${orgA.resourceId}`
      );
      expect(owned).toHaveLength(1);
    });

    it('app_public cannot INSERT an allocation with no org scope', async () => {
      const orgA = await seedResourceWorld();
      const assignee = await seedUser();
      const appointmentId = await seedAppointment({
        organizationId: orgA.organizationId,
        assignedToId: assignee.id,
      });

      const err = await capturePgError(() =>
        asRole('app_public', null, (tx) =>
          tx.execute(
            sql`INSERT INTO appointment_resource
                  (id, organization_id, appointment_id, resource_id, start_date, end_date)
                VALUES (${`ares_noscope_${appointmentId}`}, ${orgA.organizationId}, ${appointmentId}, ${orgA.resourceId},
                        now() + interval '12 days', now() + interval '12 days 1 hour')`
          )
        )
      );
      // Fail-closed on WRITES too: an unset scope does not mean "any org".
      expect(err.code).toBe(INSUFFICIENT_PRIVILEGE);
      expect(err.message).toMatch(/row-level security policy/);
    });
  });
});
