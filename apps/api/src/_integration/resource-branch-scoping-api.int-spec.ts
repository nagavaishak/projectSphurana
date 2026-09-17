/**
 * Branch scoping for rooms & equipment, over real HTTP.
 *
 * Three read endpoints — the settings list, the rooms calendar's hydration
 * feed, and the utilisation report — each take a branch from the validated
 * `X-Location-Id` header. Everything here drives the actual controller through
 * supertest, because every part of this is boundary behaviour that a service
 * test cannot see: which header the guard reads, whether the DTO strips the
 * field before it reaches the service, and which of two competing sources wins.
 *
 * WHAT MAKES THESE ASSERTIONS REAL
 *
 * `createMockDatabase()` does not execute SQL, so a unit test that queues a
 * location-less room and asserts it comes back passes just as happily against
 * a WHERE clause that would exclude it in Postgres. That is not hypothetical:
 * it is exactly how the original bug survived a test called "accepts category
 * and location filters". These run against a real database, so the predicate
 * is evaluated rather than assumed.
 *
 * THE TWO RULES UNDER TEST
 *
 *  1. NULL location means "available at every branch", never "at none". A
 *     trolley-mounted laser has no branch of its own and must appear in all of
 *     them. A filter written as a bare equality excludes precisely the rows the
 *     nullable column exists for, and the symptom — an empty list — reads as
 *     "nothing set up yet" rather than as a bug.
 *
 *  2. The HEADER outranks the query string. `LocationGuard` has validated the
 *     header against the active organization; `?locationId=` has been validated
 *     against nothing. `sales.controller.spec.ts` records what the inverted
 *     order cost: `POST /sales` once read `dto.locationId ?? activeLocationId`
 *     and let any authenticated member stamp a sale with another org's branch.
 */

import request from 'supertest';
import { ResourcesController } from '../resources/resources.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedAppointment,
  seedLocation,
  seedOrgWithMember,
} from './harness.js';
import {
  seedAllocation,
  seedResource,
  seedResourceCategory,
} from './seeds/resources.js';

const OK = 200;
const BAD_REQUEST = 400;
const CONFLICT = 409;
const NOT_FOUND = 404;

const LOCATION_HEADER = 'X-Location-Id';

interface Branches {
  organizationId: string;
  userId: string;
  dublinId: string;
  corkId: string;
  categoryId: string;
  dublinRoom: string;
  corkRoom: string;
  trolley: string;
}

/**
 * An org with two branches, one room in each, and one resource belonging to
 * neither. The third is the one that catches a bare-equality filter.
 */
async function seedTwoBranches(): Promise<Branches> {
  const owner = await seedOrgWithMember('owner');
  const { organizationId, userId } = owner;

  const dublinId = await seedLocation({
    organizationId,
    name: 'Dublin',
    isPrimary: true,
  });
  const corkId = await seedLocation({
    organizationId,
    name: 'Cork',
    isPrimary: false,
  });
  const categoryId = await seedResourceCategory({ organizationId });

  const dublinRoom = await seedResource({
    organizationId,
    categoryId,
    locationId: dublinId,
    name: 'Dublin Room 1',
    sortOrder: 0,
  });
  const corkRoom = await seedResource({
    organizationId,
    categoryId,
    locationId: corkId,
    name: 'Cork Room 1',
    sortOrder: 1,
  });
  const trolley = await seedResource({
    organizationId,
    categoryId,
    locationId: null,
    name: 'Mobile laser',
    sortOrder: 2,
  });

  return {
    organizationId,
    userId,
    dublinId,
    corkId,
    categoryId,
    dublinRoom,
    corkRoom,
    trolley,
  };
}

describe('resources API — branch scoping over HTTP', () => {
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

  const names = (body: { name: string }[]) => body.map((r) => r.name).sort();

  /**
   * The allocation and utilisation endpoints project `resourceName`, not
   * `name` — they join the resource in rather than selecting it whole. Reading
   * `.name` off those rows yields `[undefined]`, which sorts and compares
   * without complaint; that is what made the first attempt at these blocks look
   * like a scoping failure rather than a shape mismatch.
   */
  const resourceNames = (body: { resourceName: string }[]) =>
    body.map((r) => r.resourceName).sort();

  /** A window that comfortably contains every allocation seeded below. */
  const WINDOW = {
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-09-30T00:00:00.000Z',
  };
  const SLOT_START = new Date('2026-09-10T10:00:00.000Z');
  const SLOT_END = new Date('2026-09-10T11:00:00.000Z');

  /**
   * Hold `resourceId` for the fixture slot.
   *
   * Seeds a real APPOINTMENT first. `appointment_resource.appointment_id` is
   * NOT NULL with an FK, and the endpoint inner-joins the appointment to filter
   * on its status — so a synthetic id fails the insert, and an appointment in a
   * non-active status is correctly invisible.
   */
  const hold = async (
    w: Branches,
    resourceId: string,
    locationId: string | null
  ) => {
    const appointmentId = await seedAppointment({
      organizationId: w.organizationId,
      assignedToId: w.userId,
      startDate: SLOT_START,
      endDate: SLOT_END,
      locationId,
    });
    await seedAllocation({
      organizationId: w.organizationId,
      appointmentId,
      resourceId,
      startDate: SLOT_START,
      endDate: SLOT_END,
    });
    return appointmentId;
  };

  /* ------------------------------------------------------------------ */
  /* GET /resources                                                      */
  /* ------------------------------------------------------------------ */

  describe('GET /resources', () => {
    it('returns every branch when no header is sent', async () => {
      // A client that predates the header keeps seeing the whole org rather
      // than going blank. Absent must mean org-wide, never "show nothing".
      const w = await seedTwoBranches();
      const server = await build(w);

      const res = await request(server).get('/resources');

      expect(res.status).toBe(OK);
      expect(names(res.body)).toEqual([
        'Cork Room 1',
        'Dublin Room 1',
        'Mobile laser',
      ]);
    });

    it('returns the branch and the location-less resource, not the other branch', async () => {
      const w = await seedTwoBranches();
      const server = await build(w);

      const res = await request(server)
        .get('/resources')
        .set(LOCATION_HEADER, w.dublinId);

      expect(res.status).toBe(OK);
      expect(names(res.body)).toEqual(['Dublin Room 1', 'Mobile laser']);
    });

    it('is symmetric — the other branch sees its own room and the same trolley', async () => {
      const w = await seedTwoBranches();
      const server = await build(w);

      const res = await request(server)
        .get('/resources')
        .set(LOCATION_HEADER, w.corkId);

      expect(names(res.body)).toEqual(['Cork Room 1', 'Mobile laser']);
    });

    it('the header beats a query string naming another branch', async () => {
      const w = await seedTwoBranches();
      const server = await build(w);

      const res = await request(server)
        .get('/resources')
        .query({ locationId: w.corkId })
        .set(LOCATION_HEADER, w.dublinId);

      expect(res.status).toBe(OK);
      expect(names(res.body)).toEqual(['Dublin Room 1', 'Mobile laser']);
      expect(names(res.body)).not.toContain('Cork Room 1');
    });

    it('falls back to the query string when no header is sent', async () => {
      const w = await seedTwoBranches();
      const server = await build(w);

      const res = await request(server)
        .get('/resources')
        .query({ locationId: w.corkId });

      expect(names(res.body)).toEqual(['Cork Room 1', 'Mobile laser']);
    });

    it('refuses a branch belonging to another organization', async () => {
      // The guard validates the header against the ACTIVE org, so a foreign id
      // is a 404 rather than a silent org-wide read.
      const w = await seedTwoBranches();
      const stranger = await seedOrgWithMember('owner');
      const foreign = await seedLocation({
        organizationId: stranger.organizationId,
        name: 'Somebody else',
      });
      const server = await build(w);

      const res = await request(server)
        .get('/resources')
        .set(LOCATION_HEADER, foreign);

      expect(res.status).toBe(NOT_FOUND);
    });

    it('combines the branch with the category filter', async () => {
      const w = await seedTwoBranches();
      const otherCategory = await seedResourceCategory({
        organizationId: w.organizationId,
        name: 'Chairs',
      });
      await seedResource({
        organizationId: w.organizationId,
        categoryId: otherCategory,
        locationId: w.dublinId,
        name: 'Dublin Chair',
      });
      const server = await build(w);

      const res = await request(server)
        .get('/resources')
        .query({ categoryId: otherCategory })
        .set(LOCATION_HEADER, w.dublinId);

      expect(names(res.body)).toEqual(['Dublin Chair']);
    });
  });

  /* ------------------------------------------------------------------ */
  /* GET /resources/allocations — the rooms calendar's hydration feed     */
  /* ------------------------------------------------------------------ */

  describe('GET /resources/allocations', () => {
    it("returns only this branch's holds, plus the location-less resource", async () => {
      const w = await seedTwoBranches();
      await hold(w, w.dublinRoom, w.dublinId);
      await hold(w, w.corkRoom, w.corkId);
      await hold(w, w.trolley, null);
      const server = await build(w);

      const res = await request(server)
        .get('/resources/allocations')
        .query(WINDOW)
        .set(LOCATION_HEADER, w.dublinId);

      expect(res.status).toBe(OK);
      // The trolley belongs to no branch, so its hold occupies BOTH — a Dublin
      // day that hid it would offer a laser standing in Cork.
      expect(resourceNames(res.body)).toEqual([
        'Dublin Room 1',
        'Mobile laser',
      ]);
    });

    it('is org-wide when no branch is sent', async () => {
      const w = await seedTwoBranches();
      await hold(w, w.dublinRoom, w.dublinId);
      await hold(w, w.corkRoom, w.corkId);
      const server = await build(w);

      const res = await request(server)
        .get('/resources/allocations')
        .query(WINDOW);

      expect(res.status).toBe(OK);
      // `undefined` branch means org-wide, never "show nothing" — the rule the
      // bare-equality bug broke in the other direction.
      expect(resourceNames(res.body)).toEqual(['Cork Room 1', 'Dublin Room 1']);
    });

    it('the header beats a query string naming another branch', async () => {
      const w = await seedTwoBranches();
      await hold(w, w.dublinRoom, w.dublinId);
      await hold(w, w.corkRoom, w.corkId);
      const server = await build(w);

      const res = await request(server)
        .get('/resources/allocations')
        .query({ ...WINDOW, locationId: w.corkId })
        .set(LOCATION_HEADER, w.dublinId);

      expect(res.status).toBe(OK);
      // The header was validated against the active org by `LocationGuard`;
      // `?locationId=` was validated against nothing.
      expect(resourceNames(res.body)).toEqual(['Dublin Room 1']);
    });
  });

  /* ------------------------------------------------------------------ */
  /* GET /resources/utilisation                                          */
  /* ------------------------------------------------------------------ */

  describe('GET /resources/utilisation', () => {
    it('reports only this branch, plus the location-less resource', async () => {
      const w = await seedTwoBranches();
      const server = await build(w);

      const res = await request(server)
        .get('/resources/utilisation')
        .query(WINDOW)
        .set(LOCATION_HEADER, w.dublinId);

      expect(res.status).toBe(OK);
      expect(resourceNames(res.body.rows)).toEqual([
        'Dublin Room 1',
        'Mobile laser',
      ]);
    });

    it('is org-wide when no branch is sent', async () => {
      const w = await seedTwoBranches();
      const server = await build(w);

      const res = await request(server)
        .get('/resources/utilisation')
        .query(WINDOW);

      expect(res.status).toBe(OK);
      expect(resourceNames(res.body.rows)).toEqual([
        'Cork Room 1',
        'Dublin Room 1',
        'Mobile laser',
      ]);
    });
  });

  /* ------------------------------------------------------------------ */
  /* GET /resources/categories — TWO counts, because there are two        */
  /* questions                                                            */
  /* ------------------------------------------------------------------ */

  describe('GET /resources/categories', () => {
    // By ID, not by name: `seedTwoBranches` takes the seed helper's default
    // category name, and matching on it silently finds nothing.
    const byId = (body: { id: string }[], id: string) =>
      body.find((c) => c.id === id);

    it('counts this branch, and carries the org-wide number beside it', async () => {
      const w = await seedTwoBranches();
      const server = await build(w);

      const res = await request(server)
        .get('/resources/categories')
        .set(LOCATION_HEADER, w.dublinId);

      expect(res.status).toBe(OK);
      const category = byId(res.body, w.categoryId);
      expect(category).toBeTruthy();

      // Dublin's room + the trolley (which belongs to every branch).
      expect(category.resourceCount).toBe(2);
      // All three — the number `deleteResourceCategory` enforces.
      expect(category.resourceCountAllBranches).toBe(3);
    });

    it('is org-wide on both counts when no branch is sent', async () => {
      const w = await seedTwoBranches();
      const server = await build(w);

      const res = await request(server).get('/resources/categories');

      const category = byId(res.body, w.categoryId);
      expect(category.resourceCount).toBe(3);
      expect(category.resourceCountAllBranches).toBe(3);
    });

    it('explains the gap when the delete guard refuses over rooms you cannot see', async () => {
      // THE TRAP §3 NAMED. The settings list counts what is at this branch, so
      // an operator at a branch with none reads "0" — then delete refuses,
      // citing resources at other branches. The count and the refusal used to
      // contradict each other with nothing to explain it.
      const w = await seedTwoBranches();
      const emptyHere = await seedResourceCategory({
        organizationId: w.organizationId,
        name: 'Lasers',
      });
      await seedResource({
        organizationId: w.organizationId,
        categoryId: emptyHere,
        locationId: w.corkId,
        name: 'Cork Laser',
      });
      const server = await build(w);

      const list = await request(server)
        .get('/resources/categories')
        .set(LOCATION_HEADER, w.dublinId);
      const category = byId(list.body, emptyHere);
      // Nothing to show at Dublin…
      expect(category.resourceCount).toBe(0);
      // …but it is not empty, and the card can now say so.
      expect(category.resourceCountAllBranches).toBe(1);

      const deleted = await request(server)
        .delete(`/resources/categories/${emptyHere}`)
        .set(LOCATION_HEADER, w.dublinId);

      expect(deleted.status).toBe(CONFLICT);
      expect(deleted.body.message).toMatch(/another branch/i);
    });

    it('says nothing about branches when the rooms are all right here', async () => {
      // The sentence must only appear when it explains something. A category
      // whose resources are ALL at this branch reads exactly as it did before
      // branches existed.
      //
      // Its own category, deliberately: the shared one from `seedTwoBranches`
      // has a Cork room, so the sentence would be correct there and this test
      // would be asserting the wrong thing.
      const w = await seedTwoBranches();
      const dublinOnly = await seedResourceCategory({
        organizationId: w.organizationId,
        name: 'Dublin-only kit',
      });
      await seedResource({
        organizationId: w.organizationId,
        categoryId: dublinOnly,
        locationId: w.dublinId,
        name: 'Dublin Chair',
      });
      const server = await build(w);

      const deleted = await request(server)
        .delete(`/resources/categories/${dublinOnly}`)
        .set(LOCATION_HEADER, w.dublinId);

      expect(deleted.status).toBe(CONFLICT);
      expect(deleted.body.message).not.toMatch(
        /another branch|other branches/i
      );
    });
  });

  /* ------------------------------------------------------------------ */
  /* PUT /resources/reorder — a WRITE, and the only branch-scoped one     */
  /* ------------------------------------------------------------------ */

  describe('PUT /resources/reorder', () => {
    it('refuses ids from another branch', async () => {
      const w = await seedTwoBranches();
      const server = await build(w);

      // Defence in depth rather than a live bug: the settings page only ever
      // sends what it rendered, and the ids are already org-checked, so a
      // branch-scoped page cannot renumber another branch by ACCIDENT. This is
      // the deliberate case — a client that passes Cork's ids while the header
      // says Dublin was previously obeyed.
      const res = await request(server)
        .put('/resources/reorder')
        .set(LOCATION_HEADER, w.dublinId)
        .send({ items: [{ id: w.corkRoom, sortOrder: 0 }] });

      expect(res.status).toBe(BAD_REQUEST);
    });

    it('still reorders a location-less resource from any branch', async () => {
      const w = await seedTwoBranches();
      const server = await build(w);

      // THE TRAP. The trolley belongs to no branch and therefore appears in
      // every branch's list — so it is in the order the user just dragged. A
      // bare equality check would refuse the whole batch the moment a list
      // contained one, which is every list that has one.
      const res = await request(server)
        .put('/resources/reorder')
        .set(LOCATION_HEADER, w.dublinId)
        .send({
          items: [
            { id: w.trolley, sortOrder: 0 },
            { id: w.dublinRoom, sortOrder: 1 },
          ],
        });

      expect(res.status).toBe(OK);

      // Persisted, not just accepted.
      const after = await request(server)
        .get('/resources')
        .set(LOCATION_HEADER, w.dublinId);
      expect(after.body.map((r: { name: string }) => r.name)).toEqual([
        'Mobile laser',
        'Dublin Room 1',
      ]);
    });

    it('is org-wide when no branch is sent', async () => {
      const w = await seedTwoBranches();
      const server = await build(w);

      // `undefined` branch means org-wide, never "refuse everything" — the
      // same rule the reads follow.
      const res = await request(server)
        .put('/resources/reorder')
        .send({
          items: [
            { id: w.corkRoom, sortOrder: 0 },
            { id: w.dublinRoom, sortOrder: 1 },
          ],
        });

      expect(res.status).toBe(OK);
    });
  });

  /* ------------------------------------------------------------------ */
  /* Tenancy                                                             */
  /* ------------------------------------------------------------------ */

  it("refuses another organization's branch on every branch-scoped read", async () => {
    const w = await seedTwoBranches();
    const stranger = await seedOrgWithMember('owner');
    const foreignBranch = await seedLocation({
      organizationId: stranger.organizationId,
      name: 'Not ours',
      isPrimary: true,
    });
    const server = await build(w);

    // Awaited ONE AT A TIME on purpose. Building both requests eagerly into an
    // array starts them against an app that the first `await` may already be
    // tearing down, which surfaces as ECONNREFUSED and reads as a routing bug.
    for (const path of ['/resources/allocations', '/resources/utilisation']) {
      const res = await request(server)
        .get(path)
        .query(WINDOW)
        .set(LOCATION_HEADER, foreignBranch);

      // A branch id is caller-supplied. Belonging to a real org does not make
      // it ours, and the guard must refuse rather than scope to it.
      expect(res.status).toBe(NOT_FOUND);
    }
  });
});
