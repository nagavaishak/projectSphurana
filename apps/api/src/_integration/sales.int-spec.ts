import request from 'supertest';
/**
 * Fresha domain — sales / POS (asserted over HTTP against a real DB).
 *
 * Copies the timesheets exemplar's shape: the real Nest HTTP pipeline + real
 * feature services + real SQL, with only AuthGuard faked (identity stamped by
 * the harness). SalesController carries ONLY @UseGuards(AuthGuard) — there is
 * NO RoleGuard and no in-service role gate on these routes; every route is
 * org-scoped by the active organization from the (faked) auth identity. So the
 * enforced boundary this spec pins is ORG ISOLATION, not a role rule.
 *
 * Facets proven end to end:
 *
 *   a. MONEY ROUND-TRIP — create an open sale (totals 0), add a service line
 *      (subtotal/total → 5000 cents, integer cents throughout), then a full
 *      cash tender. Cash settles instantly and the service AUTO-COMPLETES a
 *      fully-paid sale (utils/auto-complete-sale.ts), so the payment response
 *      already shows status 'completed' with a succeeded cash tender — the
 *      open→completed transition. A follow-up explicit POST /complete on the
 *      now-completed sale → 400 (only an open sale can be completed), pinning
 *      the invariant.
 *
 *   b. EXPLICIT COMPLETE — a fully-settled OPEN sale transitions via
 *      POST /:id/complete. A €0 (comped) sale is open and fully paid with no
 *      tender, so the explicit endpoint drives open→completed and returns the
 *      completed row.
 *
 *   c. VOID — an open sale with no settled tender voids via POST /:id/void
 *      (status → 'voided'). A COMPLETED sale cannot be voided → 400 (the domain
 *      rule is "only an open sale can be voided — refund it instead"), so this
 *      pins the rule that IS enforced, not the idealized "complete then void".
 *
 *   d. ORG ISOLATION — the list, run as an org-A member, returns ONLY org-A
 *      sales; a cross-org GET /:id and a cross-org mutation (POST /:id/void) on
 *      an org-B sale → 404 (the service WHERE clause is `id AND organizationId`).
 *
 *   e. DTO VALIDATION — createSaleSchema's non-context fields are all optional,
 *      so an EMPTY body is valid; a MALFORMED body (leadId of the wrong type)
 *      is rejected by the service's safeParse → VALIDATION_ERROR → 400. An
 *      empty add-item body (itemType required) → 400 too.
 *
 * List returns `{ items, total, limit, offset }`; mutations return the sale
 * (createSale → the bare row; add-item / payment → SaleWithRelations with
 * `items` + `payments` arrays).
 */
import { SalesController } from '../sales/sales.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
  seedService,
} from './harness.js';
import { seedSale } from './seeds/sales.js';

interface SalePaymentRow {
  method: string;
  amountCents: number;
  status: string;
}

describe('Fresha domain — sales / POS (HTTP)', () => {
  describe('money round-trip (cash auto-completes)', () => {
    it('create → add item → cash tender completes it with integer-cent totals', async () => {
      const owner = await seedOrgWithMember('owner');
      const serviceId = await seedService({
        organizationId: owner.organizationId,
        name: 'Haircut',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SalesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        // create — open, zeroed totals
        const create = await request(server).post('/sales').send({});
        expect(create.status).toBe(201);
        expect(create.body.status).toBe('open');
        expect(create.body.subtotalCents).toBe(0);
        expect(create.body.totalCents).toBe(0);
        expect(create.body.organizationId).toBe(owner.organizationId);
        const saleId: string = create.body.id;
        expect(saleId).toBeTruthy();

        // add a service line — totals recompute to integer cents
        const addItem = await request(server)
          .post(`/sales/${saleId}/items`)
          .send({
            itemType: 'service',
            serviceId,
            name: 'Haircut',
            quantity: 1,
            unitPriceCents: 5000,
          });
        expect(addItem.status).toBe(201);
        expect(addItem.body.status).toBe('open');
        expect(addItem.body.subtotalCents).toBe(5000);
        expect(addItem.body.tipCents).toBe(0);
        expect(addItem.body.totalCents).toBe(5000);
        expect(addItem.body.items).toHaveLength(1);
        expect(addItem.body.items[0].totalCents).toBe(5000);
        expect(addItem.body.items[0].unitPriceCents).toBe(5000);

        // full cash tender — settles instantly and AUTO-COMPLETES the sale
        const pay = await request(server)
          .post(`/sales/${saleId}/payments`)
          .send({ method: 'cash', amountCents: 5000 });
        expect(pay.status).toBe(201);
        expect(pay.body.status).toBe('completed');
        expect(pay.body.totalCents).toBe(5000);
        const cash = (pay.body.payments as SalePaymentRow[]).find(
          (p) => p.method === 'cash'
        );
        expect(cash).toBeDefined();
        expect(cash?.amountCents).toBe(5000);
        expect(cash?.status).toBe('succeeded');

        // GET reflects the completed sale
        const get = await request(server).get(`/sales/${saleId}`);
        expect(get.status).toBe(200);
        expect(get.body.id).toBe(saleId);
        expect(get.body.status).toBe('completed');
        expect(get.body.totalCents).toBe(5000);

        // explicit complete on an already-completed sale → 400 (invariant)
        const complete = await request(server).post(
          `/sales/${saleId}/complete`
        );
        expect(complete.status).toBe(400);
      } finally {
        await h?.close();
      }
    });
  });

  describe('tip on a cash sale (checkout-tip)', () => {
    it('add line + tip → total includes the tip → cash pays it and completes', async () => {
      const owner = await seedOrgWithMember('owner');
      const serviceId = await seedService({
        organizationId: owner.organizationId,
        name: 'Haircut',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SalesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const create = await request(server).post('/sales').send({});
        const saleId: string = create.body.id;

        // service line 5000
        await request(server).post(`/sales/${saleId}/items`).send({
          itemType: 'service',
          serviceId,
          name: 'Haircut',
          quantity: 1,
          unitPriceCents: 5000,
        });

        // fixed-amount tip of 1000 → total recomputes to 6000
        const tip = await request(server)
          .put(`/sales/${saleId}/tip`)
          .send({ tipType: 'amount', tipAmountCents: 1000 });
        expect(tip.status).toBe(200);
        expect(tip.body.tipCents).toBe(1000);
        expect(tip.body.subtotalCents).toBe(5000);
        expect(tip.body.totalCents).toBe(6000);

        // cash tender for the tip-inclusive total auto-completes the sale
        const pay = await request(server)
          .post(`/sales/${saleId}/payments`)
          .send({ method: 'cash', amountCents: 6000 });
        expect(pay.status).toBe(201);
        expect(pay.body.status).toBe('completed');
        expect(pay.body.tipCents).toBe(1000);
        expect(pay.body.totalCents).toBe(6000);

        // the receipt (GET) reflects the tip and the settled cash tender
        const get = await request(server).get(`/sales/${saleId}`);
        expect(get.status).toBe(200);
        expect(get.body.tipCents).toBe(1000);
        expect(get.body.totalCents).toBe(6000);
        const cash = (get.body.payments as SalePaymentRow[]).find(
          (p) => p.method === 'cash'
        );
        expect(cash?.amountCents).toBe(6000);
        expect(cash?.status).toBe('succeeded');
      } finally {
        await h?.close();
      }
    });
  });

  describe('payments list (sales-derived) (payments)', () => {
    it('a completed cash sale surfaces in GET /sales with its succeeded cash tender', async () => {
      const owner = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SalesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        // ring up a completed cash sale (gift-card line needs no other entity)
        const create = await request(server).post('/sales').send({});
        const saleId: string = create.body.id;
        await request(server).post(`/sales/${saleId}/items`).send({
          itemType: 'gift_card',
          name: 'Gift card',
          quantity: 1,
          unitPriceCents: 4200,
        });
        const pay = await request(server)
          .post(`/sales/${saleId}/payments`)
          .send({ method: 'cash', amountCents: 4200 });
        expect(pay.body.status).toBe('completed');

        // the payments page reads sales; the sale + its cash tender surface in
        // the list with the settled cash payment.
        const list = await request(server).get('/sales');
        expect(list.status).toBe(200);
        const row = list.body.items.find(
          (s: { id: string }) => s.id === saleId
        );
        expect(row).toBeDefined();
        expect(row.status).toBe('completed');
        const cash = (row.payments as SalePaymentRow[]).find(
          (p) => p.method === 'cash'
        );
        expect(cash).toBeDefined();
        expect(cash?.amountCents).toBe(4200);
        expect(cash?.status).toBe('succeeded');
      } finally {
        await h?.close();
      }
    });
  });

  describe('explicit complete', () => {
    it('a fully-settled open (comped, €0) sale transitions via POST /:id/complete', async () => {
      const owner = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SalesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const create = await request(server).post('/sales').send({});
        expect(create.status).toBe(201);
        expect(create.body.status).toBe('open');
        expect(create.body.totalCents).toBe(0);
        const saleId: string = create.body.id;

        const complete = await request(server).post(
          `/sales/${saleId}/complete`
        );
        expect(complete.status).toBe(201);
        expect(complete.body.id).toBe(saleId);
        expect(complete.body.status).toBe('completed');
        expect(complete.body.completedAt).not.toBeNull();
      } finally {
        await h?.close();
      }
    });
  });

  describe('void', () => {
    it('an open sale voids; a completed sale cannot be voided → 400', async () => {
      const owner = await seedOrgWithMember('owner');
      const serviceId = await seedService({
        organizationId: owner.organizationId,
        name: 'Blow-dry',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SalesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        // open sale with an unpaid line → voidable
        const openSale = await request(server).post('/sales').send({});
        const openId: string = openSale.body.id;
        await request(server).post(`/sales/${openId}/items`).send({
          itemType: 'service',
          serviceId,
          name: 'Blow-dry',
          quantity: 1,
          unitPriceCents: 3000,
        });

        const voidRes = await request(server).post(`/sales/${openId}/void`);
        expect(voidRes.status).toBe(201);
        expect(voidRes.body.id).toBe(openId);
        expect(voidRes.body.status).toBe('voided');

        // a completed sale is NOT voidable (refund instead) → 400
        const paidSale = await request(server).post('/sales').send({});
        const paidId: string = paidSale.body.id;
        await request(server).post(`/sales/${paidId}/items`).send({
          itemType: 'service',
          serviceId,
          name: 'Blow-dry',
          quantity: 1,
          unitPriceCents: 3000,
        });
        await request(server)
          .post(`/sales/${paidId}/payments`)
          .send({ method: 'cash', amountCents: 3000 });

        const voidCompleted = await request(server).post(
          `/sales/${paidId}/void`
        );
        expect(voidCompleted.status).toBe(400);

        const stillCompleted = await request(server).get(`/sales/${paidId}`);
        expect(stillCompleted.body.status).toBe('completed');
      } finally {
        await h?.close();
      }
    });
  });

  describe('org isolation', () => {
    it('list returns only org-A sales; cross-org GET-by-id and mutation → 404', async () => {
      const orgA = await seedOrgWithMember('member');
      const orgB = await seedOrgWithMember('member');

      const a1 = await seedSale({
        organizationId: orgA.organizationId,
        createdById: orgA.userId,
      });
      const a2 = await seedSale({
        organizationId: orgA.organizationId,
        createdById: orgA.userId,
      });
      const b1 = await seedSale({
        organizationId: orgB.organizationId,
        createdById: orgB.userId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SalesController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const server = h.app.getHttpServer();

        const list = await request(server).get('/sales');
        expect(list.status).toBe(200);
        const ids = list.body.items.map((s: { id: string }) => s.id).sort();
        expect(ids).toEqual([a1, a2].sort());
        expect(ids).not.toContain(b1);

        // org A asking for org B's sale → 404
        const cross = await request(server).get(`/sales/${b1}`);
        expect(cross.status).toBe(404);

        // org A mutating org B's sale → 404
        const crossVoid = await request(server).post(`/sales/${b1}/void`);
        expect(crossVoid.status).toBe(404);

        // sanity: org A's own sale IS reachable
        const own = await request(server).get(`/sales/${a1}`);
        expect(own.status).toBe(200);
        expect(own.body.id).toBe(a1);
      } finally {
        await h?.close();
      }
    });
  });

  describe('DTO validation', () => {
    it('create with a malformed body → 400; add-item with an empty body → 400', async () => {
      const owner = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SalesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        // leadId must be a non-empty string — a number fails the schema
        const badCreate = await request(server)
          .post('/sales')
          .send({ leadId: 123 });
        expect(badCreate.status).toBe(400);

        // add-item requires itemType (+ exactly one FK) — empty body → 400
        const create = await request(server).post('/sales').send({});
        const saleId: string = create.body.id;
        const badItem = await request(server)
          .post(`/sales/${saleId}/items`)
          .send({});
        expect(badItem.status).toBe(400);
      } finally {
        await h?.close();
      }
    });
  });
});
