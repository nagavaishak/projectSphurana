import request from 'supertest';
/**
 * Fresha domain — SCHEDULING (blocked-time / time-off / blocked-time-types /
 * shifts), asserted over HTTP against a real DB.
 *
 * Shape copied from the timesheets exemplar: the real Nest HTTP pipeline + real
 * feature services + real SQL, with only the AuthGuard faked (identity stamped
 * by the harness). Unlike timesheets, ALL four scheduling controllers carry
 * ONLY `@UseGuards(AuthGuard)` — no RoleGuard on the route and no in-service
 * role gate. The enforced rule is therefore ORG SCOPE ONLY: every service
 * filters by the caller's active organization, so a mutation aimed at another
 * org's row resolves nothing and maps to 404. This spec pins the rule that IS
 * enforced (org isolation + DTO validation), not an assumed role boundary.
 *
 * Response-shape notes proven below:
 *  - `createBlockedTime` returns the series row + `practitionerIds`.
 *  - `listBlockedTime` returns EXPANDED occurrences; for a one-off block the
 *    occurrence `id` equals the series id and `blockedTimeId` points at it.
 *  - `listTimeOff` returns raw `time_off` rows (id = row id).
 *  - `listShifts` returns resolved per-practitioner-per-date days; a weekly
 *    pattern row surfaces once per matching weekday in the window.
 *  - delete endpoints return `{ success: true }`.
 *
 * NOTE: the appointment-booking flow is deliberately untouched (other WIP).
 */
import { BlockedTimeTypesController } from '../blocked-time/blocked-time-types.controller.js';
import { BlockedTimeController } from '../blocked-time/blocked-time.controller.js';
import { ShiftsController } from '../shifts/shifts.controller.js';
import { TimeOffController } from '../time-off/time-off.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
  seedPractitioner,
} from './harness.js';
import {
  seedBlockedTime,
  seedBlockedTimeType,
  seedTimeOff,
} from './seeds/scheduling.js';

// A window that comfortably brackets every fixed date used by the seeds/POSTs.
const WINDOW = {
  from: '2030-06-01T00:00:00.000Z',
  to: '2030-06-30T00:00:00.000Z',
};

describe('Fresha domain — scheduling (HTTP)', () => {
  /* -------------------------------------------------------------- */
  /* blocked-time                                                   */
  /* -------------------------------------------------------------- */
  describe('blocked-time', () => {
    it('CRUD round-trip: POST → GET list → PUT → DELETE', async () => {
      const owner = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(BlockedTimeController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        // create
        const created = await request(server).post('/blocked-time').send({
          title: 'Team Meeting',
          startDate: '2030-06-05T09:00:00.000Z',
          endDate: '2030-06-05T10:00:00.000Z',
        });
        expect(created.status).toBe(201);
        expect(created.body.organizationId).toBe(owner.organizationId);
        expect(created.body.title).toBe('Team Meeting');
        expect(created.body.practitionerIds).toEqual([]);
        const id: string = created.body.id;
        expect(id).toBeTruthy();

        // list includes the (expanded) one-off occurrence
        const list = await request(server).get('/blocked-time').query(WINDOW);
        expect(list.status).toBe(200);
        const occ = list.body.find((b: { id: string }) => b.id === id);
        expect(occ).toBeTruthy();
        expect(occ.blockedTimeId).toBe(id);
        expect(occ.title).toBe('Team Meeting');

        // update the series title (scope defaults to 'all')
        const updated = await request(server)
          .put(`/blocked-time/${id}`)
          .send({ title: 'All-hands' });
        expect(updated.status).toBe(200);
        expect(updated.body.title).toBe('All-hands');

        const listAfter = await request(server)
          .get('/blocked-time')
          .query(WINDOW);
        expect(
          listAfter.body.find((b: { id: string }) => b.id === id).title
        ).toBe('All-hands');

        // delete
        const del = await request(server).delete(`/blocked-time/${id}`);
        expect(del.status).toBe(200);
        expect(del.body).toEqual({ success: true });

        const listGone = await request(server)
          .get('/blocked-time')
          .query(WINDOW);
        expect(listGone.body.map((b: { id: string }) => b.id)).not.toContain(
          id
        );
      } finally {
        await h?.close();
      }
    });

    it('org isolation: list is org-scoped; cross-org PUT/DELETE :id → 404', async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');

      const a1 = await seedBlockedTime({
        organizationId: orgA.organizationId,
        createdById: orgA.userId,
        title: 'A block',
      });
      const b1 = await seedBlockedTime({
        organizationId: orgB.organizationId,
        createdById: orgB.userId,
        title: 'B block',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(BlockedTimeController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const server = h.app.getHttpServer();

        // list run as org A shows only org A's occurrence
        const list = await request(server).get('/blocked-time').query(WINDOW);
        expect(list.status).toBe(200);
        const ids = list.body.map((b: { id: string }) => b.id);
        expect(ids).toContain(a1);
        expect(ids).not.toContain(b1);

        // org A mutating org B's block → 404 (service WHERE id AND organizationId)
        const crossPut = await request(server)
          .put(`/blocked-time/${b1}`)
          .send({ title: 'hijack' });
        expect(crossPut.status).toBe(404);

        const crossDel = await request(server).delete(`/blocked-time/${b1}`);
        expect(crossDel.status).toBe(404);

        // sanity: org A's own block IS reachable
        const ownPut = await request(server)
          .put(`/blocked-time/${a1}`)
          .send({ title: 'renamed' });
        expect(ownPut.status).toBe(200);
      } finally {
        await h?.close();
      }
    });

    it('DTO validation: POST with an empty body → 400', async () => {
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(BlockedTimeController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/blocked-time')
          .send({});
        expect(res.status).toBe(400);
      } finally {
        await h?.close();
      }
    });
  });

  /* -------------------------------------------------------------- */
  /* time-off                                                       */
  /* -------------------------------------------------------------- */
  describe('time-off', () => {
    it('CRUD round-trip: POST → GET list → PUT → DELETE', async () => {
      const owner = await seedOrgWithMember('owner');
      const practitionerId = await seedPractitioner({
        organizationId: owner.organizationId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(TimeOffController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const created = await request(server).post('/time-off').send({
          practitionerId,
          type: 'sick_leave',
          startDate: '2030-06-12T00:00:00.000Z',
          endDate: '2030-06-13T00:00:00.000Z',
        });
        expect(created.status).toBe(201);
        expect(created.body.organizationId).toBe(owner.organizationId);
        expect(created.body.practitionerId).toBe(practitionerId);
        expect(created.body.type).toBe('sick_leave');
        const id: string = created.body.id;
        expect(id).toBeTruthy();

        const list = await request(server).get('/time-off').query(WINDOW);
        expect(list.status).toBe(200);
        expect(list.body.map((t: { id: string }) => t.id)).toContain(id);

        const updated = await request(server)
          .put(`/time-off/${id}`)
          .send({ type: 'training' });
        expect(updated.status).toBe(200);
        expect(updated.body.type).toBe('training');

        const del = await request(server).delete(`/time-off/${id}`);
        expect(del.status).toBe(200);
        expect(del.body).toEqual({ success: true });

        const gone = await request(server).get('/time-off').query(WINDOW);
        expect(gone.body.map((t: { id: string }) => t.id)).not.toContain(id);
      } finally {
        await h?.close();
      }
    });

    it('org isolation: list is org-scoped; cross-org PUT/DELETE :id → 404', async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const pracA = await seedPractitioner({
        organizationId: orgA.organizationId,
      });
      const pracB = await seedPractitioner({
        organizationId: orgB.organizationId,
      });

      const a1 = await seedTimeOff({
        organizationId: orgA.organizationId,
        practitionerId: pracA,
        createdById: orgA.userId,
      });
      const b1 = await seedTimeOff({
        organizationId: orgB.organizationId,
        practitionerId: pracB,
        createdById: orgB.userId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(TimeOffController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const server = h.app.getHttpServer();

        const list = await request(server).get('/time-off').query(WINDOW);
        expect(list.status).toBe(200);
        const ids = list.body.map((t: { id: string }) => t.id);
        expect(ids).toContain(a1);
        expect(ids).not.toContain(b1);

        const crossPut = await request(server)
          .put(`/time-off/${b1}`)
          .send({ type: 'other' });
        expect(crossPut.status).toBe(404);

        const crossDel = await request(server).delete(`/time-off/${b1}`);
        expect(crossDel.status).toBe(404);
      } finally {
        await h?.close();
      }
    });
  });

  /* -------------------------------------------------------------- */
  /* blocked-time-types                                             */
  /* -------------------------------------------------------------- */
  describe('blocked-time-types', () => {
    it('CRUD round-trip: POST → GET list → PUT → DELETE', async () => {
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(BlockedTimeTypesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const created = await request(server)
          .post('/blocked-time-types')
          .send({ name: 'Lunch', durationMinutes: 30, paid: false });
        expect(created.status).toBe(201);
        expect(created.body.organizationId).toBe(owner.organizationId);
        expect(created.body.name).toBe('Lunch');
        const id: string = created.body.id;

        const list = await request(server).get('/blocked-time-types');
        expect(list.status).toBe(200);
        expect(list.body.map((t: { id: string }) => t.id)).toContain(id);

        const updated = await request(server)
          .put(`/blocked-time-types/${id}`)
          .send({ durationMinutes: 45 });
        expect(updated.status).toBe(200);
        expect(updated.body.durationMinutes).toBe(45);

        const del = await request(server).delete(`/blocked-time-types/${id}`);
        expect(del.status).toBe(200);
        expect(del.body).toEqual({ success: true });

        const gone = await request(server).get('/blocked-time-types');
        expect(gone.body.map((t: { id: string }) => t.id)).not.toContain(id);
      } finally {
        await h?.close();
      }
    });

    it('org isolation: list only my org; cross-org DELETE :id → 404', async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const a1 = await seedBlockedTimeType({
        organizationId: orgA.organizationId,
        name: 'A-Lunch',
      });
      const b1 = await seedBlockedTimeType({
        organizationId: orgB.organizationId,
        name: 'B-Lunch',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(BlockedTimeTypesController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const server = h.app.getHttpServer();

        const list = await request(server).get('/blocked-time-types');
        const ids = list.body.map((t: { id: string }) => t.id);
        expect(ids).toContain(a1);
        expect(ids).not.toContain(b1);

        const crossDel = await request(server).delete(
          `/blocked-time-types/${b1}`
        );
        expect(crossDel.status).toBe(404);
      } finally {
        await h?.close();
      }
    });
  });

  /* -------------------------------------------------------------- */
  /* shifts                                                         */
  /* -------------------------------------------------------------- */
  describe('shifts', () => {
    // 7 consecutive calendar days => each weekday 0..6 appears exactly once,
    // so a weekly-pattern row surfaces exactly once regardless of runner TZ.
    const SHIFT_WINDOW = {
      from: '2030-06-01T00:00:00.000Z',
      to: '2030-06-07T00:00:00.000Z',
    };

    it('PUT /shifts/weekly/:practitionerId sets a pattern; GET reflects it', async () => {
      const owner = await seedOrgWithMember('owner');
      const practitionerId = await seedPractitioner({
        organizationId: owner.organizationId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(ShiftsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        // Monday (1) and Wednesday (3), one interval each.
        const setRes = await request(server)
          .put(`/shifts/weekly/${practitionerId}`)
          .send({
            days: [
              {
                dayOfWeek: 1,
                intervals: [{ startMinutes: 540, endMinutes: 1020 }],
              },
              {
                dayOfWeek: 3,
                intervals: [{ startMinutes: 540, endMinutes: 1020 }],
              },
            ],
          });
        expect(setRes.status).toBe(200);
        expect(Array.isArray(setRes.body)).toBe(true);
        expect(setRes.body).toHaveLength(2);

        const list = await request(server).get('/shifts').query(SHIFT_WINDOW);
        expect(list.status).toBe(200);
        const mine = list.body.filter(
          (d: { practitionerId: string }) => d.practitionerId === practitionerId
        );
        // Exactly the two configured weekdays resolve within a 7-day window.
        expect(mine).toHaveLength(2);
        for (const day of mine) {
          expect(day.source).toBe('weekly');
          expect(day.isOff).toBe(false);
          expect(day.intervals).toHaveLength(1);
          expect(day.intervals[0].startMinutes).toBe(540);
          expect(day.intervals[0].endMinutes).toBe(1020);
        }
        expect(
          mine.map((d: { dayOfWeek: number }) => d.dayOfWeek).sort()
        ).toEqual([1, 3]);
      } finally {
        await h?.close();
      }
    });

    it('org isolation: another org never sees my weekly pattern', async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const pracA = await seedPractitioner({
        organizationId: orgA.organizationId,
      });

      // org A sets a weekly pattern for its own practitioner.
      let hA: IntegrationApp | undefined;
      let hB: IntegrationApp | undefined;
      try {
        hA = await buildControllerApp(ShiftsController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const setRes = await request(hA.app.getHttpServer())
          .put(`/shifts/weekly/${pracA}`)
          .send({
            days: [
              {
                dayOfWeek: 2,
                intervals: [{ startMinutes: 600, endMinutes: 900 }],
              },
            ],
          });
        expect(setRes.status).toBe(200);

        // org B, querying the SAME window and even filtering on org A's
        // practitioner id, sees nothing (shifts are org-scoped).
        hB = await buildControllerApp(ShiftsController, {
          userId: orgB.userId,
          organizationId: orgB.organizationId,
        });
        const list = await request(hB.app.getHttpServer())
          .get('/shifts')
          .query({ ...SHIFT_WINDOW, practitionerId: pracA });
        expect(list.status).toBe(200);
        expect(list.body).toEqual([]);
      } finally {
        await hA?.close();
        await hB?.close();
      }
    });

    it("rejects writing a weekly pattern for another org's practitioner → 404", async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const pracA = await seedPractitioner({
        organizationId: orgA.organizationId,
      });

      // org B tries to set a pattern for org A's practitioner. The writer
      // verifies practitioner-org ownership, so this is a 404 — not a silent
      // 200 creating a shift whose org != the practitioner's org.
      let hB: IntegrationApp | undefined;
      try {
        hB = await buildControllerApp(ShiftsController, {
          userId: orgB.userId,
          organizationId: orgB.organizationId,
        });
        const res = await request(hB.app.getHttpServer())
          .put(`/shifts/weekly/${pracA}`)
          .send({
            days: [
              {
                dayOfWeek: 2,
                intervals: [{ startMinutes: 600, endMinutes: 900 }],
              },
            ],
          });
        expect(res.status).toBe(404);
      } finally {
        await hB?.close();
      }
    });
  });
});
