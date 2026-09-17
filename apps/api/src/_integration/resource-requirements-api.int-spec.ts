/**
 * Phase 7 §7g — the resources controller, over real HTTP.
 *
 * Everything here goes through the actual Nest pipeline that production uses:
 * routing, the global `ZodValidationPipe`, the `@Query()` / `@Param()` / `@Body()`
 * decorators, the real feature services and real SQL. Only `AuthGuard` is faked
 * (the harness stamps an identity), because this file is about the TRANSPORT
 * boundary — which is precisely where the bugs that unit tests cannot see live.
 *
 * Behaviour locked here:
 *  - Full CRUD round-trips for categories and resources, read back from the
 *    list endpoints rather than inferred from a 200.
 *  - `PUT /resources/requirements/:serviceId` REPLACES the whole set. A payload
 *    that fails leaves the PREVIOUS set completely intact — including a failure
 *    that only surfaces INSIDE the transaction, after the deletes have already
 *    run. Without the transaction, a rejected save would wipe a clinic's rules
 *    and gate nothing.
 *  - An empty `eligibleResourceIds` writes ZERO eligibility rows. That is the
 *    "any resource in this category" contract; expanding it into one row per
 *    resource would silently break the moment the clinic adds a room.
 *  - `turnaroundMinutes` validation is enforced at the boundary: 0 and 240 are
 *    accepted, `null` clears it, 7 (not a multiple of 5) and 245 are 400s.
 *  - `PUT /resources/reorder` persists `sortOrder` and refuses a batch
 *    containing another org's id — a foreign id fails the whole batch rather
 *    than silently no-op'ing one row.
 *  - CROSS-ORG: every read is scoped and every write against another org's id
 *    is a 404. Never another org's data, never a 500.
 *  - ⚠️  QUERY-PARAM COERCION IS BROKEN ON THIS CONTROLLER, and the failure is
 *    pinned here rather than papered over: `?includeInactive=true` is a 400 in
 *    production because `resources.controller.ts` imports its DTOs with
 *    `import type`, which erases the class from `design:paramtypes` and makes
 *    the global `ZodValidationPipe` skip every parameter on the controller. See
 *    `KNOWN BUG:` below for the mechanism, the proof, and the one-word fix.
 *  - EMPTY STATE is `[]` with a 200 on every list endpoint, never a 500.
 *  - ROUTE ORDER IS LOAD-BEARING. Nest matches in declaration order, so
 *    `reorder` / `requirements/:serviceId` / `utilisation` / `allocations` must
 *    all resolve to themselves and not be swallowed by the `:id` routes below
 *    them — `PUT /resources/reorder` becoming "update the resource whose id is
 *    `reorder`" is a 404 at best and a silent no-op at worst.
 */
import {
  db,
  serviceResourceEligibility,
  serviceResourceRequirement,
} from '@borradh-workspace/database';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { ResourcesController } from '../resources/resources.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';
import {
  seedRequirement,
  seedResource,
  seedResourceCategory,
  seedResourceService,
} from './seeds/resources.js';

const OK = 200;
const CREATED = 201;
const BAD_REQUEST = 400;
const NOT_FOUND = 404;

/** A window comfortably bracketing anything the report endpoints are asked for. */
const WINDOW = {
  from: '2030-06-01T00:00:00.000Z',
  to: '2030-06-08T00:00:00.000Z',
};

/** Eligibility rows actually on disk for a service — the "zero rows" contract. */
const eligibilityRows = (serviceId: string) =>
  db
    .select({ resourceId: serviceResourceEligibility.resourceId })
    .from(serviceResourceEligibility)
    .where(eq(serviceResourceEligibility.serviceId, serviceId));

/** Requirement rows actually on disk for a service. */
const requirementRows = (serviceId: string) =>
  db
    .select({ categoryId: serviceResourceRequirement.categoryId })
    .from(serviceResourceRequirement)
    .where(eq(serviceResourceRequirement.serviceId, serviceId));

describe('Phase 7 §7g — resources controller (HTTP)', () => {
  let h: IntegrationApp | undefined;

  afterEach(async () => {
    await h?.close();
    h = undefined;
  });

  const build = async (identity: {
    userId: string;
    organizationId: string;
  }) => {
    h = await buildControllerApp(ResourcesController, identity);
    return h.app.getHttpServer();
  };

  /* ---------------------------------------------------------------- */
  /* CRUD                                                              */
  /* ---------------------------------------------------------------- */

  it('category CRUD round-trip: POST → GET → PUT → DELETE', async () => {
    const owner = await seedOrgWithMember('owner');
    const server = await build(owner);

    const created = await request(server)
      .post('/resources/categories')
      .send({ name: 'Treatment rooms', kind: 'room', sortOrder: 3 });
    expect(created.status).toBe(CREATED);
    expect(created.body.name).toBe('Treatment rooms');
    expect(created.body.kind).toBe('room');
    expect(created.body.organizationId).toBe(owner.organizationId);
    const id: string = created.body.id;

    const listed = await request(server).get('/resources/categories');
    expect(listed.status).toBe(OK);
    expect(listed.body.map((row: { id: string }) => row.id)).toContain(id);

    const updated = await request(server)
      .put(`/resources/categories/${id}`)
      .send({ name: 'Renamed rooms', kind: 'equipment' });
    expect(updated.status).toBe(OK);
    expect(updated.body.name).toBe('Renamed rooms');
    expect(updated.body.kind).toBe('equipment');

    const removed = await request(server).delete(`/resources/categories/${id}`);
    expect(removed.status).toBe(OK);
    expect(removed.body).toEqual({ success: true });

    // Soft-deleted, so it disappears from the list entirely.
    const after = await request(server).get('/resources/categories');
    expect(after.status).toBe(OK);
    expect(after.body.map((row: { id: string }) => row.id)).not.toContain(id);
  });

  it('resource CRUD round-trip: POST → GET → PUT → DELETE', async () => {
    const owner = await seedOrgWithMember('owner');
    const server = await build(owner);
    const categoryId = await seedResourceCategory({
      organizationId: owner.organizationId,
      name: 'Rooms',
    });

    const created = await request(server)
      .post('/resources')
      .send({
        categoryId,
        name: 'Room 1',
        capacity: 2,
        specs: { Device: 'Lumenis M22' },
      });
    expect(created.status).toBe(CREATED);
    expect(created.body.name).toBe('Room 1');
    expect(created.body.capacity).toBe(2);
    expect(created.body.specs).toEqual({ Device: 'Lumenis M22' });
    const id: string = created.body.id;

    const listed = await request(server).get('/resources');
    expect(listed.status).toBe(OK);
    const row = listed.body.find((r: { id: string }) => r.id === id);
    expect(row).toBeTruthy();
    // The list hydrates the category — the settings screen groups by it.
    expect(row.category).toEqual(
      expect.objectContaining({ id: categoryId, name: 'Rooms' })
    );

    const updated = await request(server)
      .put(`/resources/${id}`)
      .send({ name: 'Room One', capacity: 1, workingHours: null });
    expect(updated.status).toBe(OK);
    expect(updated.body.name).toBe('Room One');
    expect(updated.body.capacity).toBe(1);

    const removed = await request(server).delete(`/resources/${id}`);
    expect(removed.status).toBe(OK);
    expect(removed.body).toEqual({ success: true });
    const afterDelete = await request(server).get('/resources');
    expect(afterDelete.body.map((r: { id: string }) => r.id)).not.toContain(id);
  });

  it('POST /resources with a category from another org is a 404, not a foreign write', async () => {
    const owner = await seedOrgWithMember('owner');
    const other = await seedOrgWithMember('owner');
    const foreignCategory = await seedResourceCategory({
      organizationId: other.organizationId,
    });
    const server = await build(owner);

    const created = await request(server)
      .post('/resources')
      .send({ categoryId: foreignCategory, name: 'Smuggled room' });
    expect(created.status).toBe(NOT_FOUND);

    // Nothing landed in either org.
    const mine = await request(server).get('/resources');
    expect(mine.body).toEqual([]);
  });

  /* ---------------------------------------------------------------- */
  /* PUT /resources/requirements/:serviceId                            */
  /* ---------------------------------------------------------------- */

  it('PUT requirements replaces the whole set, and GET reads it back hydrated', async () => {
    const owner = await seedOrgWithMember('owner');
    const server = await build(owner);
    const serviceId = await seedResourceService({
      organizationId: owner.organizationId,
    });
    const rooms = await seedResourceCategory({
      organizationId: owner.organizationId,
      name: 'Rooms',
    });
    const lasers = await seedResourceCategory({
      organizationId: owner.organizationId,
      name: 'Lasers',
      kind: 'equipment',
    });
    const laserA = await seedResource({
      organizationId: owner.organizationId,
      categoryId: lasers,
      name: 'Laser A',
    });

    const first = await request(server)
      .put(`/resources/requirements/${serviceId}`)
      .send({
        turnaroundMinutes: 15,
        requirements: [
          { categoryId: rooms, eligibleResourceIds: [] },
          { categoryId: lasers, eligibleResourceIds: [laserA] },
        ],
      });
    expect(first.status).toBe(OK);
    expect(first.body.turnaroundMinutes).toBe(15);

    const read = await request(server).get(
      `/resources/requirements/${serviceId}`
    );
    expect(read.status).toBe(OK);
    expect(read.body.turnaroundMinutes).toBe(15);
    expect(
      read.body.requirements
        .map((row: { categoryId: string }) => row.categoryId)
        .sort()
    ).toEqual([rooms, lasers].sort());
    const laserRequirement = read.body.requirements.find(
      (row: { categoryId: string }) => row.categoryId === lasers
    );
    expect(laserRequirement.categoryName).toBe('Lasers');
    expect(laserRequirement.categoryKind).toBe('equipment');
    expect(laserRequirement.eligibleResourceIds).toEqual([laserA]);

    // REPLACE, not merge: the Lasers requirement and its eligibility row go.
    const second = await request(server)
      .put(`/resources/requirements/${serviceId}`)
      .send({ requirements: [{ categoryId: rooms, eligibleResourceIds: [] }] });
    expect(second.status).toBe(OK);

    expect((await requirementRows(serviceId)).map((r) => r.categoryId)).toEqual(
      [rooms]
    );
    expect(await eligibilityRows(serviceId)).toEqual([]);
    // …and turnaround was left alone, because the payload omitted it.
    const afterReplace = await request(server).get(
      `/resources/requirements/${serviceId}`
    );
    expect(afterReplace.body.turnaroundMinutes).toBe(15);

    // An EMPTY requirement list clears everything — the un-gating path.
    const cleared = await request(server)
      .put(`/resources/requirements/${serviceId}`)
      .send({ requirements: [] });
    expect(cleared.status).toBe(OK);
    expect(await requirementRows(serviceId)).toEqual([]);
  });

  it('empty eligibleResourceIds writes ZERO eligibility rows (the "any resource" contract)', async () => {
    const owner = await seedOrgWithMember('owner');
    const server = await build(owner);
    const serviceId = await seedResourceService({
      organizationId: owner.organizationId,
    });
    const rooms = await seedResourceCategory({
      organizationId: owner.organizationId,
      name: 'Rooms',
    });
    // Three real rooms exist. A naive implementation would "helpfully" write one
    // eligibility row per room, which reads identically today and breaks
    // silently the moment room 4 is added.
    for (const name of ['Room 1', 'Room 2', 'Room 3']) {
      await seedResource({
        organizationId: owner.organizationId,
        categoryId: rooms,
        name,
      });
    }

    const saved = await request(server)
      .put(`/resources/requirements/${serviceId}`)
      .send({ requirements: [{ categoryId: rooms, eligibleResourceIds: [] }] });
    expect(saved.status).toBe(OK);

    expect(await eligibilityRows(serviceId)).toEqual([]);
    expect(await requirementRows(serviceId)).toHaveLength(1);

    const read = await request(server).get(
      `/resources/requirements/${serviceId}`
    );
    expect(read.body.requirements[0].eligibleResourceIds).toEqual([]);
  });

  it('a PUT rejected during VALIDATION leaves the previous set completely intact', async () => {
    const owner = await seedOrgWithMember('owner');
    const other = await seedOrgWithMember('owner');
    const server = await build(owner);
    const serviceId = await seedResourceService({
      organizationId: owner.organizationId,
    });
    const rooms = await seedResourceCategory({
      organizationId: owner.organizationId,
      name: 'Rooms',
    });
    const roomA = await seedResource({
      organizationId: owner.organizationId,
      categoryId: rooms,
      name: 'Room A',
    });
    const foreignCategory = await seedResourceCategory({
      organizationId: other.organizationId,
      name: 'Their rooms',
    });

    const saved = await request(server)
      .put(`/resources/requirements/${serviceId}`)
      .send({
        requirements: [{ categoryId: rooms, eligibleResourceIds: [roomA] }],
      });
    expect(saved.status).toBe(OK);

    // A payload that names a valid category AND a foreign one.
    const rejected = await request(server)
      .put(`/resources/requirements/${serviceId}`)
      .send({
        requirements: [
          { categoryId: rooms, eligibleResourceIds: [] },
          { categoryId: foreignCategory, eligibleResourceIds: [] },
        ],
      });
    expect(rejected.status).toBe(BAD_REQUEST);

    // The clinic's existing rules survived untouched — including the
    // eligibility narrowing the good half of the payload would have removed.
    expect((await requirementRows(serviceId)).map((r) => r.categoryId)).toEqual(
      [rooms]
    );
    expect((await eligibilityRows(serviceId)).map((r) => r.resourceId)).toEqual(
      [roomA]
    );
  });

  it('a PUT that fails INSIDE the transaction rolls the deletes back too', async () => {
    // The strongest form of the transactional claim. A duplicate resource id in
    // one requirement's eligible list passes every pre-flight check (both
    // copies really are in that category) and only fails on INSERT, against
    // `service_resource_eligibility_unique` — i.e. AFTER the deletes have run.
    // If the replace were not one transaction, the clinic would be left with no
    // requirements at all and every gated service silently ungated.
    const owner = await seedOrgWithMember('owner');
    const server = await build(owner);
    const serviceId = await seedResourceService({
      organizationId: owner.organizationId,
    });
    const rooms = await seedResourceCategory({
      organizationId: owner.organizationId,
      name: 'Rooms',
    });
    const roomA = await seedResource({
      organizationId: owner.organizationId,
      categoryId: rooms,
      name: 'Room A',
    });
    const lasers = await seedResourceCategory({
      organizationId: owner.organizationId,
      name: 'Lasers',
      kind: 'equipment',
    });

    const saved = await request(server)
      .put(`/resources/requirements/${serviceId}`)
      .send({
        turnaroundMinutes: 20,
        requirements: [
          { categoryId: rooms, eligibleResourceIds: [roomA] },
          { categoryId: lasers, eligibleResourceIds: [] },
        ],
      });
    expect(saved.status).toBe(OK);

    const doomed = await request(server)
      .put(`/resources/requirements/${serviceId}`)
      .send({
        requirements: [
          { categoryId: rooms, eligibleResourceIds: [roomA, roomA] },
        ],
      });
    expect(doomed.status).not.toBe(OK);

    // Everything the previous save wrote is still there.
    expect(
      (await requirementRows(serviceId)).map((r) => r.categoryId).sort()
    ).toEqual([rooms, lasers].sort());
    expect((await eligibilityRows(serviceId)).map((r) => r.resourceId)).toEqual(
      [roomA]
    );
    const read = await request(server).get(
      `/resources/requirements/${serviceId}`
    );
    expect(read.body.turnaroundMinutes).toBe(20);
  });

  it('GET/PUT requirements for another org’s service is a 404', async () => {
    const owner = await seedOrgWithMember('owner');
    const other = await seedOrgWithMember('owner');
    const foreignService = await seedResourceService({
      organizationId: other.organizationId,
    });
    const foreignCategory = await seedResourceCategory({
      organizationId: other.organizationId,
    });
    await seedRequirement({
      organizationId: other.organizationId,
      serviceId: foreignService,
      categoryId: foreignCategory,
    });
    const server = await build(owner);

    const read = await request(server).get(
      `/resources/requirements/${foreignService}`
    );
    expect(read.status).toBe(NOT_FOUND);
    // Not merely "no data" — no data AT ALL about the neighbouring clinic.
    expect(JSON.stringify(read.body)).not.toContain(foreignCategory);

    const write = await request(server)
      .put(`/resources/requirements/${foreignService}`)
      .send({ requirements: [] });
    expect(write.status).toBe(NOT_FOUND);
    // The other org's rules were not touched.
    expect(await requirementRows(foreignService)).toHaveLength(1);
  });

  /* ---------------------------------------------------------------- */
  /* turnaroundMinutes validation                                      */
  /* ---------------------------------------------------------------- */

  describe('turnaroundMinutes validation at the boundary', () => {
    const setTurnaround = (
      server: unknown,
      serviceId: string,
      turnaroundMinutes: number | null
    ) =>
      request(server as never)
        .put(`/resources/requirements/${serviceId}`)
        .send({ turnaroundMinutes, requirements: [] });

    it.each([
      [0, OK],
      [5, OK],
      [240, OK],
      [7, BAD_REQUEST],
      [-5, BAD_REQUEST],
      [245, BAD_REQUEST],
      [12.5, BAD_REQUEST],
    ])('turnaroundMinutes %p → %p', async (value, expected) => {
      const owner = await seedOrgWithMember('owner');
      const server = await build(owner);
      const serviceId = await seedResourceService({
        organizationId: owner.organizationId,
      });

      const response = await setTurnaround(server, serviceId, value as number);
      expect(response.status).toBe(expected);
      if (expected === OK) expect(response.body.turnaroundMinutes).toBe(value);
    });

    it('null clears the turnaround', async () => {
      const owner = await seedOrgWithMember('owner');
      const server = await build(owner);
      const serviceId = await seedResourceService({
        organizationId: owner.organizationId,
        turnaroundMinutes: 30,
      });

      const cleared = await setTurnaround(server, serviceId, null);
      expect(cleared.status).toBe(OK);
      expect(cleared.body.turnaroundMinutes).toBeNull();

      const read = await request(server).get(
        `/resources/requirements/${serviceId}`
      );
      expect(read.body.turnaroundMinutes).toBeNull();
    });
  });

  /* ---------------------------------------------------------------- */
  /* Reorder                                                           */
  /* ---------------------------------------------------------------- */

  it('PUT /resources/reorder persists sortOrder', async () => {
    const owner = await seedOrgWithMember('owner');
    const server = await build(owner);
    const categoryId = await seedResourceCategory({
      organizationId: owner.organizationId,
      name: 'Rooms',
    });
    const first = await seedResource({
      organizationId: owner.organizationId,
      categoryId,
      name: 'Alpha',
      sortOrder: 0,
    });
    const second = await seedResource({
      organizationId: owner.organizationId,
      categoryId,
      name: 'Beta',
      sortOrder: 1,
    });

    const reordered = await request(server)
      .put('/resources/reorder')
      .send({
        items: [
          { id: first, sortOrder: 5 },
          { id: second, sortOrder: 2 },
        ],
      });
    expect(reordered.status).toBe(OK);

    // The list is ordered by category order, then resource order — so the swap
    // is visible in the response the settings screen actually renders.
    const listed = await request(server).get('/resources');
    expect(listed.body.map((row: { id: string }) => row.id)).toEqual([
      second,
      first,
    ]);
  });

  it('PUT /resources/reorder rejects the whole batch when it contains another org’s id', async () => {
    const owner = await seedOrgWithMember('owner');
    const other = await seedOrgWithMember('owner');
    const server = await build(owner);
    const categoryId = await seedResourceCategory({
      organizationId: owner.organizationId,
    });
    const mine = await seedResource({
      organizationId: owner.organizationId,
      categoryId,
      name: 'Mine',
      sortOrder: 0,
    });
    const foreignCategory = await seedResourceCategory({
      organizationId: other.organizationId,
    });
    const theirs = await seedResource({
      organizationId: other.organizationId,
      categoryId: foreignCategory,
      name: 'Theirs',
      sortOrder: 0,
    });

    const rejected = await request(server)
      .put('/resources/reorder')
      .send({
        items: [
          { id: mine, sortOrder: 9 },
          { id: theirs, sortOrder: 9 },
        ],
      });
    expect(rejected.status).toBe(BAD_REQUEST);

    // Neither row moved — a foreign id fails the batch, it does not silently
    // apply the half that was legitimate.
    const listed = await request(server).get('/resources');
    expect(
      listed.body.find((row: { id: string }) => row.id === mine).sortOrder
    ).toBe(0);
  });

  /* ---------------------------------------------------------------- */
  /* Cross-org                                                         */
  /* ---------------------------------------------------------------- */

  it('cross-org reads and writes: scoped lists, 404 on foreign ids, never another org’s data', async () => {
    const owner = await seedOrgWithMember('owner');
    const other = await seedOrgWithMember('owner');
    const foreignCategory = await seedResourceCategory({
      organizationId: other.organizationId,
      name: 'Their rooms',
    });
    const foreignResource = await seedResource({
      organizationId: other.organizationId,
      categoryId: foreignCategory,
      name: 'Their Room 1',
    });
    const server = await build(owner);

    const categories = await request(server).get('/resources/categories');
    expect(categories.status).toBe(OK);
    expect(categories.body).toEqual([]);

    const resources = await request(server).get('/resources');
    expect(resources.status).toBe(OK);
    expect(resources.body).toEqual([]);
    expect(JSON.stringify(resources.body)).not.toContain('Their Room 1');

    for (const [method, path] of [
      ['put', `/resources/${foreignResource}`],
      ['delete', `/resources/${foreignResource}`],
      ['put', `/resources/categories/${foreignCategory}`],
      ['delete', `/resources/categories/${foreignCategory}`],
    ] as const) {
      const response = await (method === 'put'
        ? request(server).put(path).send({ name: 'Hijacked' })
        : request(server).delete(path));
      expect([method, path, response.status]).toEqual([
        method,
        path,
        NOT_FOUND,
      ]);
    }

    // The neighbouring clinic's rows are untouched.
    const theirServer = await (async () => {
      await h?.close();
      h = await buildControllerApp(ResourcesController, other);
      return h.app.getHttpServer();
    })();
    const theirs = await request(theirServer).get('/resources');
    expect(theirs.body).toHaveLength(1);
    expect(theirs.body[0].name).toBe('Their Room 1');
  });

  it('no active organization on the session is a 400, never an unscoped read', async () => {
    const owner = await seedOrgWithMember('owner');
    h = await buildControllerApp(ResourcesController, {
      userId: owner.userId,
      organizationId: undefined,
    });
    const server = h.app.getHttpServer();

    const listed = await request(server).get('/resources');
    expect(listed.status).toBe(BAD_REQUEST);
  });

  /* ---------------------------------------------------------------- */
  /* Query-param coercion                                              */
  /* ---------------------------------------------------------------- */

  /**
   * `?includeInactive` — the transport-boundary coercion.
   *
   * This was a shipping blocker, and it failed SILENTLY at the type level:
   * `resources.controller.ts` imported its DTOs with `import type`, which
   * erases the class at runtime. With nothing in `design:paramtypes`, every
   * handler on the controller reported its DTO parameter as plain `Object`,
   * nestjs-zod's global `ZodValidationPipe` skipped it, and the raw string
   * "true" fell through to a feature schema declaring a real `z.boolean()`.
   * Result: `GET /resources?includeInactive=true` was a 400, so the Rooms &
   * equipment settings page could not load at all.
   *
   * The fix is a value import. This test asserts BOTH halves so it cannot
   * regress quietly: the runtime metadata the pipe depends on, and the
   * behaviour that metadata buys. A lint autofix "tidying" the import back to
   * `import type` fails here, not in production.
   *
   * (~30 other controllers still use `import type`; this file only speaks for
   * `/resources`.)
   */
  it('coerces ?includeInactive at the transport boundary', async () => {
    const owner = await seedOrgWithMember('owner');
    const server = await build(owner);
    const activeCategory = await seedResourceCategory({
      organizationId: owner.organizationId,
      name: 'Live rooms',
    });
    const live = await seedResource({
      organizationId: owner.organizationId,
      categoryId: activeCategory,
      name: 'Live room',
    });
    const retired = await seedResource({
      organizationId: owner.organizationId,
      categoryId: activeCategory,
      name: 'Retired room',
      isActive: false,
    });

    // ── The runtime metadata the pipe depends on. ─────────────────────────
    // `Object` here means the DTO was erased and NOTHING on this controller is
    // validated — the exact silent failure this test exists to catch.
    const paramTypes: Array<{ name?: string } | undefined> =
      Reflect.getMetadata(
        'design:paramtypes',
        ResourcesController.prototype,
        'findAll'
      ) ?? [];
    expect(paramTypes[0]?.name).toBe('ListResourcesDto');

    // ── The behaviour it buys. ────────────────────────────────────────────
    const included = await request(server)
      .get('/resources')
      .query({ includeInactive: 'true' });
    expect(included.status).toBe(OK);
    expect(included.body.map((row: { id: string }) => row.id).sort()).toEqual(
      [live, retired].sort()
    );

    // "false" must read as FALSE. `z.coerce.boolean()` would get this
    // backwards (non-empty string is truthy), which is why the DTO uses
    // `queryBoolean()`.
    const excluded = await request(server)
      .get('/resources')
      .query({ includeInactive: 'false' });
    expect(excluded.status).toBe(OK);
    expect(excluded.body.map((row: { id: string }) => row.id)).toEqual([live]);

    // Omitted behaves like false.
    const omitted = await request(server).get('/resources');
    expect(omitted.status).toBe(OK);
    expect(omitted.body.map((row: { id: string }) => row.id)).toEqual([live]);

    // Categories take the same parameter through the same pipe.
    const categories = await request(server)
      .get('/resources/categories')
      .query({ includeInactive: 'true' });
    expect(categories.status).toBe(OK);
  });

  it('date query params arrive as strings and are coerced, not rejected', async () => {
    const owner = await seedOrgWithMember('owner');
    const server = await build(owner);

    const utilisation = await request(server)
      .get('/resources/utilisation')
      .query(WINDOW);
    expect(utilisation.status).toBe(OK);

    const allocations = await request(server)
      .get('/resources/allocations')
      .query(WINDOW);
    expect(allocations.status).toBe(OK);

    // An unparseable date still fails — coercion is not permissiveness.
    const bad = await request(server)
      .get('/resources/allocations')
      .query({ from: 'not-a-date', to: WINDOW.to });
    expect(bad.status).toBe(BAD_REQUEST);

    // And a backwards window is refused by the service, so HTTP and internal
    // callers cannot disagree about the rule.
    const backwards = await request(server)
      .get('/resources/allocations')
      .query({ from: WINDOW.to, to: WINDOW.from });
    expect(backwards.status).toBe(BAD_REQUEST);
  });

  /* ---------------------------------------------------------------- */
  /* Empty state                                                       */
  /* ---------------------------------------------------------------- */

  it('empty state: every list endpoint returns an empty result with 200, never a 500', async () => {
    const owner = await seedOrgWithMember('owner');
    const server = await build(owner);

    const categories = await request(server).get('/resources/categories');
    expect([categories.status, categories.body]).toEqual([OK, []]);

    const resources = await request(server).get('/resources');
    expect([resources.status, resources.body]).toEqual([OK, []]);

    const allocations = await request(server)
      .get('/resources/allocations')
      .query(WINDOW);
    expect([allocations.status, allocations.body]).toEqual([OK, []]);

    const utilisation = await request(server)
      .get('/resources/utilisation')
      .query(WINDOW);
    expect(utilisation.status).toBe(OK);
    expect(utilisation.body.rows).toEqual([]);

    // A service that has never been configured reports "no requirements",
    // which is a 200 with an empty list — not a 404 and not a 500.
    const serviceId = await seedResourceService({
      organizationId: owner.organizationId,
    });
    const requirements = await request(server).get(
      `/resources/requirements/${serviceId}`
    );
    expect(requirements.status).toBe(OK);
    expect(requirements.body.requirements).toEqual([]);
    expect(requirements.body.turnaroundMinutes).toBeNull();
  });

  /* ---------------------------------------------------------------- */
  /* Route ordering                                                    */
  /* ---------------------------------------------------------------- */

  it('ROUTE ORDER: reorder / requirements / utilisation / allocations are not swallowed by the :id routes', async () => {
    const owner = await seedOrgWithMember('owner');
    const server = await build(owner);
    const categoryId = await seedResourceCategory({
      organizationId: owner.organizationId,
      name: 'Rooms',
    });
    const resourceId = await seedResource({
      organizationId: owner.organizationId,
      categoryId,
      name: 'Room 1',
      sortOrder: 0,
    });
    const serviceId = await seedResourceService({
      organizationId: owner.organizationId,
    });

    // `PUT /resources/reorder`. If `@Put(':id')` had been declared first this
    // would be "update the resource whose id is `reorder`" → 404, and the
    // sortOrder below would never move.
    const reorder = await request(server)
      .put('/resources/reorder')
      .send({ items: [{ id: resourceId, sortOrder: 7 }] });
    expect(reorder.status).toBe(OK);
    const listed = await request(server).get('/resources');
    expect(listed.body[0].sortOrder).toBe(7);

    // `GET /resources/utilisation` — the report shape, which a resource lookup
    // could never produce.
    const utilisation = await request(server)
      .get('/resources/utilisation')
      .query(WINDOW);
    expect(utilisation.status).toBe(OK);
    expect(utilisation.body).toEqual(
      expect.objectContaining({ rows: expect.any(Array) })
    );
    expect(utilisation.body.id).toBeUndefined();

    // `GET /resources/allocations` — an ARRAY, not a resource object.
    const allocations = await request(server)
      .get('/resources/allocations')
      .query(WINDOW);
    expect(allocations.status).toBe(OK);
    expect(Array.isArray(allocations.body)).toBe(true);

    // `GET|PUT /resources/requirements/:serviceId`.
    const requirements = await request(server).get(
      `/resources/requirements/${serviceId}`
    );
    expect(requirements.status).toBe(OK);
    expect(requirements.body.serviceId).toBe(serviceId);

    const savedRequirements = await request(server)
      .put(`/resources/requirements/${serviceId}`)
      .send({ requirements: [{ categoryId, eligibleResourceIds: [] }] });
    expect(savedRequirements.status).toBe(OK);
    expect(await requirementRows(serviceId)).toHaveLength(1);

    // `categories` likewise stays ahead of `:id`.
    const categories = await request(server).get('/resources/categories');
    expect(categories.status).toBe(OK);
    expect(categories.body.map((row: { id: string }) => row.id)).toEqual([
      categoryId,
    ]);

    // …and the `:id` routes themselves still work, so the ordering did not fix
    // the literals by breaking the parameterised ones.
    const updated = await request(server)
      .put(`/resources/${resourceId}`)
      .send({ name: 'Renamed' });
    expect(updated.status).toBe(OK);
    expect(updated.body.name).toBe('Renamed');
  });

  it('deleting a category that still has resources is a CONFLICT naming the count', async () => {
    const owner = await seedOrgWithMember('owner');
    const server = await build(owner);
    const categoryId = await seedResourceCategory({
      organizationId: owner.organizationId,
      name: 'Rooms',
    });
    for (const name of ['Room 1', 'Room 2']) {
      await seedResource({
        organizationId: owner.organizationId,
        categoryId,
        name,
      });
    }

    const removed = await request(server).delete(
      `/resources/categories/${categoryId}`
    );
    expect(removed.status).toBe(409);
    expect(removed.body.message).toContain('2');

    // Still there — the refusal was not cosmetic.
    const categories = await request(server).get('/resources/categories');
    expect(categories.body.map((row: { id: string }) => row.id)).toEqual([
      categoryId,
    ]);
  });

  it('a duplicate category name in one org is a CONFLICT, and a soft-deleted name is reusable', async () => {
    const owner = await seedOrgWithMember('owner');
    const server = await build(owner);

    const first = await request(server)
      .post('/resources/categories')
      .send({ name: 'Rooms' });
    expect(first.status).toBe(CREATED);

    const duplicate = await request(server)
      .post('/resources/categories')
      .send({ name: 'Rooms' });
    expect(duplicate.status).toBe(409);

    // The uniqueness index is PARTIAL (`WHERE deleted_at IS NULL`), so
    // deleting frees the name again.
    const removed = await request(server).delete(
      `/resources/categories/${first.body.id}`
    );
    expect(removed.status).toBe(OK);

    const reused = await request(server)
      .post('/resources/categories')
      .send({ name: 'Rooms' });
    expect(reused.status).toBe(CREATED);
    expect(reused.body.id).not.toBe(first.body.id);
  });
});
