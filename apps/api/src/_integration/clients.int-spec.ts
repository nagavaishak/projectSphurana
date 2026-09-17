import request from 'supertest';
/**
 * Fresha domain — clients / leads (asserted over HTTP against a real DB).
 *
 * Moves the PERSISTENCE coverage of three browser E2E specs down to the fast
 * harness: clients/client-create.spec.ts, clients/client-edit.spec.ts, and
 * clients/client-profile-data.spec.ts. Exercises the real Nest HTTP pipeline +
 * real feature services + real SQL, with only the AuthGuard faked (identity
 * stamped by the harness).
 *
 * LeadsController carries @UseGuards(AuthGuard, RoleGuard). None of the routes
 * touched here declare @RequireRole/@RequirePermission, so RoleGuard is a
 * passthrough (it only needs the caller to BE a member of the org — which
 * seedOrgWithMember guarantees). The enforced boundary is org-scope, exactly
 * like the timesheets exemplar.
 *
 * NOTE on normalizeLead: LeadsController.create runs the fields through a
 * best-effort GPT-4o normalizer (proper-case names, E.164 phones, lowercase
 * emails). It is explicitly best-effort — on any model failure it passes the
 * raw input through unchanged — so it never blocks creation and is not asserted
 * here. To stay deterministic regardless of whether the normalizer ran, the
 * create round-trip asserts (a) fields the normalizer NEVER touches
 * (source/status/notes/tags/consent), and (b) that GET reads back byte-for-byte
 * what POST persisted (both come from the same row, so they always agree).
 *
 * Facets proven end to end:
 *
 *   a. CREATE PERSISTS + READS BACK (client-create) — POST /leads persists a new
 *      lead; GET /leads/:id returns the saved row with the non-normalized fields
 *      exactly as sent. It also appears in GET /leads.
 *   b. UPDATE PERSISTS (client-edit) — PUT /leads/:id changes a field; GET reads
 *      the new value back (a fresh read, not in-memory form state).
 *   c. PROFILE DATA (client-profile-data) — a seeded appointment and a completed
 *      cash sale attached to a lead read back under that lead via the
 *      leadId-filtered list endpoints (GET /appointments?leadId,
 *      GET /sales?leadId) — i.e. the client profile's Appointments + Sales tabs
 *      render real data, not the empty state.
 */
import { AppointmentsController } from '../appointments/appointments.controller.js';
import { GiftCardsController } from '../gift-cards/gift-cards.controller.js';
import { LeadsController } from '../leads/leads.controller.js';
import { SalesController } from '../sales/sales.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';

describe('Fresha domain — clients / leads (HTTP)', () => {
  describe('create persists + reads back (client-create)', () => {
    it('POST /leads persists the row; GET reads it back and it lists', async () => {
      const owner = await seedOrgWithMember('owner');
      const stamp = Date.now();

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(LeadsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const create = await request(server)
          .post('/leads')
          .send({
            firstName: 'Alice',
            lastName: 'Nguyen',
            email: `e2e.create.${stamp}@example.com`,
            source: 'website',
            status: 'new',
            tags: [`vip-${stamp}`],
            notes: `Prefers afternoons ${stamp}`,
            consentEmail: true,
            consentSms: true,
          });
        expect(create.status).toBe(201);
        const leadId: string = create.body.id;
        expect(leadId).toBeTruthy();
        expect(create.body.organizationId).toBe(owner.organizationId);
        // Non-normalized fields persist exactly as sent.
        expect(create.body.source).toBe('website');
        expect(create.body.status).toBe('new');
        expect(create.body.notes).toBe(`Prefers afternoons ${stamp}`);
        expect(create.body.tags).toEqual([`vip-${stamp}`]);
        expect(create.body.consentEmail).toBe(true);
        expect(create.body.consentSms).toBe(true);

        // GET reads back the SAME persisted row (agrees with POST regardless of
        // whether the best-effort normalizer touched name/email).
        const get = await request(server).get(`/leads/${leadId}`);
        expect(get.status).toBe(200);
        expect(get.body.id).toBe(leadId);
        expect(get.body.source).toBe('website');
        expect(get.body.notes).toBe(`Prefers afternoons ${stamp}`);
        expect(get.body.firstName).toBe(create.body.firstName);
        expect(get.body.email).toBe(create.body.email);

        // And it surfaces in the org-scoped list.
        const list = await request(server).get('/leads');
        expect(list.status).toBe(200);
        const ids = list.body.items.map((l: { id: string }) => l.id);
        expect(ids).toContain(leadId);
      } finally {
        await h?.close();
      }
    });
  });

  describe('update persists (client-edit)', () => {
    it('PUT /leads/:id changes a field and GET reads the new value back', async () => {
      const owner = await seedOrgWithMember('owner');
      const stamp = Date.now();

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(LeadsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const create = await request(server).post('/leads').send({
          firstName: 'Bob',
          lastName: 'Okonkwo',
          source: 'manual',
          status: 'new',
        });
        expect(create.status).toBe(201);
        const leadId: string = create.body.id;

        const update = await request(server)
          .put(`/leads/${leadId}`)
          .send({ status: 'contacted', notes: `edited ${stamp}` });
        expect(update.status).toBe(200);
        expect(update.body.status).toBe('contacted');
        expect(update.body.notes).toBe(`edited ${stamp}`);

        // Fresh read reflects the persisted change.
        const get = await request(server).get(`/leads/${leadId}`);
        expect(get.status).toBe(200);
        expect(get.body.status).toBe('contacted');
        expect(get.body.notes).toBe(`edited ${stamp}`);
      } finally {
        await h?.close();
      }
    });
  });

  describe('profile data reads back under the client (client-profile-data)', () => {
    it('a seeded appointment + completed cash sale surface via the leadId-filtered lists', async () => {
      const owner = await seedOrgWithMember('owner');
      const stamp = Date.now();

      let leadsApp: IntegrationApp | undefined;
      let apptApp: IntegrationApp | undefined;
      let salesApp: IntegrationApp | undefined;
      let giftApp: IntegrationApp | undefined;
      try {
        // 1. Create the client (lead).
        leadsApp = await buildControllerApp(LeadsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const created = await request(leadsApp.app.getHttpServer())
          .post('/leads')
          .send({ firstName: `ProfileClient${stamp}` });
        expect(created.status).toBe(201);
        const leadId: string = created.body.id;

        // 2. Book an appointment for that client.
        apptApp = await buildControllerApp(AppointmentsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const apptServer = apptApp.app.getHttpServer();
        const start = new Date(Date.now() + 60 * 60 * 1000);
        const end = new Date(start.getTime() + 60 * 60 * 1000);
        const apptTitle = `Booking ${stamp}`;
        const appt = await request(apptServer).post('/appointments').send({
          title: apptTitle,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          leadId,
        });
        expect(appt.status).toBe(201);
        const apptId: string = appt.body.id;

        // The client's Appointments tab: leadId-filtered list returns it.
        const apptList = await request(apptServer).get(
          `/appointments?leadId=${leadId}`
        );
        expect(apptList.status).toBe(200);
        const apptIds = apptList.body.items.map((a: { id: string }) => a.id);
        expect(apptIds).toContain(apptId);
        expect(apptList.body.items[0].title).toBe(apptTitle);

        // 3. Ring up a completed CASH sale for that client (gift-card line so no
        //    other entity is needed; cash auto-completes without Stripe).
        salesApp = await buildControllerApp(SalesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const salesServer = salesApp.app.getHttpServer();
        const sale = await request(salesServer).post('/sales').send({ leadId });
        expect(sale.status).toBe(201);
        const saleId: string = sale.body.id;
        await request(salesServer)
          .post(`/sales/${saleId}/items`)
          .send({
            itemType: 'gift_card',
            name: `Gift ${stamp}`,
            quantity: 1,
            unitPriceCents: 5000,
          });
        const pay = await request(salesServer)
          .post(`/sales/${saleId}/payments`)
          .send({ method: 'cash', amountCents: 5000 });
        expect(pay.status).toBe(201);
        expect(pay.body.status).toBe('completed');

        // The client's Sales tab: leadId-filtered list returns the completed sale.
        const saleList = await request(salesServer).get(
          `/sales?leadId=${leadId}`
        );
        expect(saleList.status).toBe(200);
        const saleRow = saleList.body.items.find(
          (s: { id: string }) => s.id === saleId
        );
        expect(saleRow).toBeDefined();
        expect(saleRow.status).toBe('completed');
        expect(saleRow.totalCents).toBe(5000);

        // Sanity: the gift card issued at completion exists for the org.
        giftApp = await buildControllerApp(GiftCardsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const cards = await request(giftApp.app.getHttpServer()).get(
          '/gift-cards'
        );
        expect(cards.status).toBe(200);
        expect(cards.body.items.length).toBeGreaterThan(0);
      } finally {
        await giftApp?.close();
        await salesApp?.close();
        await apptApp?.close();
        await leadsApp?.close();
      }
    });
  });
});
