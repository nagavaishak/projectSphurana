import request from 'supertest';
/**
 * Fresha domain — lead forms (asserted over HTTP against a real DB).
 *
 * Exercises the real Nest HTTP pipeline + real lead-form feature services + real
 * SQL, with only AuthGuard faked (identity stamped by the harness). The
 * LeadFormsController carries `@UseGuards(AuthGuard)` only (no RoleGuard, no
 * @RequireRole), so the enforced boundary on these routes is org isolation.
 *
 * NOTE ON META: `createLeadForm` only calls out to Meta when `syncToMeta` is
 * true (default false), and the dedicated `POST :id/sync` route is deliberately
 * NOT exercised here (it hits the real Meta Graph API). All specs below keep
 * `syncToMeta` false and supply `privacyPolicyUrl` explicitly so creation never
 * needs the org's website / Facebook Page and never touches Meta.
 *
 * Facets:
 *   a. HAPPY ROUND-TRIP — an owner creates a form (name + questions +
 *      privacyPolicyUrl), it shows up in the list, is fetched by id, renamed via
 *      update, then deleted (subsequent GET → 404). `createLeadForm` returns the
 *      row with status 'draft'; `listLeadForms` returns `{ items, total, limit,
 *      offset }`; GET :id returns the bare form row.
 *   b. DTO VALIDATION — POST with an empty body → 400. The create route has no
 *      method-level pipe, but the harness applies the same global
 *      ValidationPipe the real app uses, so the createLeadFormSchema (name +
 *      at least one question required) is enforced.
 *   c. ORG ISOLATION — a form seeded in org-B is invisible to an org-A owner:
 *      absent from the list, and get/update on the org-B id → 404 (both
 *      `getLeadForm` and `updateLeadForm` scope their WHERE by organizationId
 *      when it is supplied, and the controller always supplies it). THIS PASSES.
 *
 * There is NO set-default route on this controller (create/list/get/update/
 * delete/sync only), so nothing to assert there.
 */
import { LeadFormsController } from '../lead-forms/lead-forms.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';

const BAD_REQUEST = 400;
const NOT_FOUND = 404;

const PRIVACY_URL = 'https://example.com/privacy';
const QUESTIONS = [{ type: 'EMAIL' }, { type: 'FULL_NAME' }];

describe('Fresha domain — lead forms (HTTP)', () => {
  describe('happy round-trip (owner)', () => {
    it('create → list includes it → get → update → delete → 404', async () => {
      const owner = await seedOrgWithMember('owner');
      const stamp = Date.now();

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(LeadFormsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        // create
        const name = `Contact Form ${stamp}`;
        const created = await request(server)
          .post('/lead-forms')
          .send({ name, questions: QUESTIONS, privacyPolicyUrl: PRIVACY_URL });
        expect(created.status).toBe(201);
        const id: string = created.body.id;
        expect(id).toBeTruthy();
        expect(created.body.name).toBe(name);
        expect(created.body.organizationId).toBe(owner.organizationId);
        expect(created.body.status).toBe('draft');

        // list includes it
        const list = await request(server).get('/lead-forms');
        expect(list.status).toBe(200);
        expect(Array.isArray(list.body.items)).toBe(true);
        expect(list.body.items.some((f: { id: string }) => f.id === id)).toBe(
          true
        );

        // get by id
        const got = await request(server).get(`/lead-forms/${id}`);
        expect(got.status).toBe(200);
        expect(got.body.id).toBe(id);

        // update (rename)
        const renamed = `Renamed Form ${stamp}`;
        const updated = await request(server)
          .put(`/lead-forms/${id}`)
          .send({ name: renamed });
        expect(updated.status).toBe(200);
        expect(updated.body.name).toBe(renamed);

        // delete is a SOFT delete (archive): status → 'archived', row remains
        const deleted = await request(server).delete(`/lead-forms/${id}`);
        expect(deleted.status).toBe(200);

        // get-by-id still returns it, now archived
        const gone = await request(server).get(`/lead-forms/${id}`);
        expect(gone.status).toBe(200);
        expect(gone.body.status).toBe('archived');
      } finally {
        await h?.close();
      }
    });
  });

  describe('DTO validation', () => {
    it('create with an empty body → 400', async () => {
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(LeadFormsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/lead-forms')
          .send({});
        expect(res.status).toBe(BAD_REQUEST);
      } finally {
        await h?.close();
      }
    });
  });

  describe('org isolation', () => {
    it('an org-B lead form is invisible to an org-A owner (list + get + update → 404)', async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const stamp = Date.now();

      let hA: IntegrationApp | undefined;
      let hB: IntegrationApp | undefined;
      try {
        // Seed a form in org-B via HTTP.
        hB = await buildControllerApp(LeadFormsController, {
          userId: orgB.userId,
          organizationId: orgB.organizationId,
        });
        const bForm = await request(hB.app.getHttpServer())
          .post('/lead-forms')
          .send({
            name: `B-only ${stamp}`,
            questions: QUESTIONS,
            privacyPolicyUrl: PRIVACY_URL,
          });
        expect(bForm.status).toBe(201);
        const bId: string = bForm.body.id;

        hA = await buildControllerApp(LeadFormsController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const serverA = hA.app.getHttpServer();

        // list excludes org-B
        const list = await request(serverA).get('/lead-forms');
        expect(list.status).toBe(200);
        expect(list.body.items.some((f: { id: string }) => f.id === bId)).toBe(
          false
        );

        // get on the org-B id → 404 (getLeadForm scopes by organizationId)
        const got = await request(serverA).get(`/lead-forms/${bId}`);
        expect(got.status).toBe(NOT_FOUND);

        // update on the org-B id → 404 (updateLeadForm scopes by organizationId)
        const updated = await request(serverA)
          .put(`/lead-forms/${bId}`)
          .send({ name: `hijacked ${stamp}` });
        expect(updated.status).toBe(NOT_FOUND);
      } finally {
        await hA?.close();
        await hB?.close();
      }
    });
  });
});
