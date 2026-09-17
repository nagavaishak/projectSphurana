import request from 'supertest';
/**
 * Fresha domain — gift-cards (asserted over HTTP against a real DB).
 *
 * Copies the timesheets exemplar shape: the real Nest HTTP pipeline + real
 * feature services + real SQL, with only the AuthGuard faked (identity stamped
 * by the harness). Facets proven end to end:
 *
 *   a. ADJUST (balance mutation) — seed a card, POST /gift-cards/:id/adjust with
 *      a credit then a debit; each response returns the recomputed balanceCents,
 *      and a `gift_card_transaction` ledger row is recorded per adjustment. An
 *      over-draw (balance would go negative) → 400 (INVALID_STATE), balance
 *      unchanged.
 *   b. GET BY CODE — GET /gift-cards/by-code/:code returns the right card; a code
 *      that belongs to ANOTHER org → 404 (getGiftCard filters on organizationId).
 *   c. ORG ISOLATION — the list, run as an org-A member, returns only org-A cards;
 *      a cross-org GET /gift-cards/:id on an org-B card → 404 (the service WHERE
 *      clause is `organizationId AND id`).
 *   d. DTO VALIDATION — adjust with an empty body → 400 (amountCents required),
 *      and adjust with amountCents: 0 → 400 (schema refine forbids zero).
 *
 * ROLE BOUNDARY: none. GiftCardsController carries only @UseGuards(AuthGuard) —
 * no RoleGuard and no per-role gate in the controller or services. The rule that
 * IS enforced is org-scoping (via ActiveOrganization + the service WHERE
 * clauses), which facets b & c pin. So this spec asserts the enforced rule, not
 * an assumed one.
 *
 * SHAPES: adjust + get return the bare gift-card row (`result.data`); get also
 * carries a `transactions` array. list returns `{ items, total, limit, offset }`.
 */
import { GiftCardsController } from '../gift-cards/gift-cards.controller.js';
import { SalesController } from '../sales/sales.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';
import { countGiftCardTransactions, seedGiftCard } from './seeds/gift-cards.js';

describe('Fresha domain — gift-cards (HTTP)', () => {
  describe('issue via a completed cash sale (sales/gift-cards)', () => {
    it('a gift_card line on a fully-paid cash sale issues a card, and adjust reads back', async () => {
      const owner = await seedOrgWithMember('owner');

      let salesApp: IntegrationApp | undefined;
      let giftApp: IntegrationApp | undefined;
      try {
        // There is no direct gift-card create endpoint — a card is ISSUED when
        // a sale with a gift_card line completes. Drive the POS cash path.
        salesApp = await buildControllerApp(SalesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const salesServer = salesApp.app.getHttpServer();
        const create = await request(salesServer).post('/sales').send({});
        const saleId: string = create.body.id;
        await request(salesServer).post(`/sales/${saleId}/items`).send({
          itemType: 'gift_card',
          name: 'Gift card',
          quantity: 1,
          unitPriceCents: 7500,
        });
        const pay = await request(salesServer)
          .post(`/sales/${saleId}/payments`)
          .send({ method: 'cash', amountCents: 7500 });
        expect(pay.body.status).toBe('completed');

        // the issued card surfaces for the org with balance = line total
        giftApp = await buildControllerApp(GiftCardsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const giftServer = giftApp.app.getHttpServer();
        const list = await request(giftServer).get('/gift-cards');
        expect(list.status).toBe(200);
        expect(list.body.items.length).toBeGreaterThan(0);
        const issued = list.body.items[0];
        expect(issued.balanceCents).toBe(7500);
        expect(issued.initialAmountCents).toBe(7500);
        expect(issued.code).toBeTruthy();

        // top up the balance via the signed adjust endpoint (cash-tier, no Stripe)
        const adjust = await request(giftServer)
          .post(`/gift-cards/${issued.id}/adjust`)
          .send({ amountCents: 2500, reason: 'top-up' });
        expect(adjust.status).toBe(201);
        expect(adjust.body.balanceCents).toBe(10000);

        // and the new balance reads back
        const get = await request(giftServer).get(`/gift-cards/${issued.id}`);
        expect(get.status).toBe(200);
        expect(get.body.balanceCents).toBe(10000);
      } finally {
        await giftApp?.close();
        await salesApp?.close();
      }
    });
  });

  describe('adjust (balance mutation)', () => {
    it('credit then debit recompute the balance and record ledger rows', async () => {
      const owner = await seedOrgWithMember('owner');
      const giftCardId = await seedGiftCard({
        organizationId: owner.organizationId,
        balanceCents: 5000,
        initialAmountCents: 5000,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(GiftCardsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        // credit +1500 → 6500
        const credit = await request(server)
          .post(`/gift-cards/${giftCardId}/adjust`)
          .send({ amountCents: 1500 });
        expect(credit.status).toBe(201);
        expect(credit.body.id).toBe(giftCardId);
        expect(credit.body.balanceCents).toBe(6500);
        expect(await countGiftCardTransactions(giftCardId)).toBe(1);

        // debit -2000 → 4500
        const debit = await request(server)
          .post(`/gift-cards/${giftCardId}/adjust`)
          .send({ amountCents: -2000 });
        expect(debit.status).toBe(201);
        expect(debit.body.balanceCents).toBe(4500);
        expect(await countGiftCardTransactions(giftCardId)).toBe(2);
      } finally {
        await h?.close();
      }
    });

    it('over-draw beyond the balance → 400 and leaves the balance untouched', async () => {
      const owner = await seedOrgWithMember('owner');
      const giftCardId = await seedGiftCard({
        organizationId: owner.organizationId,
        balanceCents: 3000,
        initialAmountCents: 3000,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(GiftCardsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const res = await request(server)
          .post(`/gift-cards/${giftCardId}/adjust`)
          .send({ amountCents: -5000 });
        expect(res.status).toBe(400);
        // no ledger row recorded for the rejected adjustment
        expect(await countGiftCardTransactions(giftCardId)).toBe(0);

        // balance is still 3000
        const get = await request(server).get(`/gift-cards/${giftCardId}`);
        expect(get.status).toBe(200);
        expect(get.body.balanceCents).toBe(3000);
      } finally {
        await h?.close();
      }
    });
  });

  describe('get by code', () => {
    it('returns the matching card; a code from another org → 404', async () => {
      const orgA = await seedOrgWithMember('member');
      const orgB = await seedOrgWithMember('member');

      const aCode = 'GC-AAAA-BBBB-CCCC';
      const bCode = 'GC-XXXX-YYYY-ZZZZ';
      const aId = await seedGiftCard({
        organizationId: orgA.organizationId,
        code: aCode,
      });
      await seedGiftCard({ organizationId: orgB.organizationId, code: bCode });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(GiftCardsController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const server = h.app.getHttpServer();

        const own = await request(server).get(`/gift-cards/by-code/${aCode}`);
        expect(own.status).toBe(200);
        expect(own.body.id).toBe(aId);
        expect(own.body.code).toBe(aCode);
        expect(Array.isArray(own.body.transactions)).toBe(true);

        // org A asking for org B's code → 404
        const cross = await request(server).get(`/gift-cards/by-code/${bCode}`);
        expect(cross.status).toBe(404);
      } finally {
        await h?.close();
      }
    });
  });

  describe('org isolation', () => {
    it('list returns only org-A cards; cross-org GET-by-id → 404', async () => {
      const orgA = await seedOrgWithMember('member');
      const orgB = await seedOrgWithMember('member');

      const a1 = await seedGiftCard({
        organizationId: orgA.organizationId,
        code: 'GC-A1',
      });
      const a2 = await seedGiftCard({
        organizationId: orgA.organizationId,
        code: 'GC-A2',
      });
      const b1 = await seedGiftCard({
        organizationId: orgB.organizationId,
        code: 'GC-B1',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(GiftCardsController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const server = h.app.getHttpServer();

        const list = await request(server).get('/gift-cards');
        expect(list.status).toBe(200);
        const ids = list.body.items.map((c: { id: string }) => c.id).sort();
        expect(ids).toEqual([a1, a2].sort());
        expect(ids).not.toContain(b1);

        // org A asking for org B's card by id → 404
        const cross = await request(server).get(`/gift-cards/${b1}`);
        expect(cross.status).toBe(404);

        // sanity: org A's own card IS reachable
        const own = await request(server).get(`/gift-cards/${a1}`);
        expect(own.status).toBe(200);
        expect(own.body.id).toBe(a1);
      } finally {
        await h?.close();
      }
    });
  });

  describe('DTO validation', () => {
    it('adjust with an empty body → 400', async () => {
      const owner = await seedOrgWithMember('owner');
      const giftCardId = await seedGiftCard({
        organizationId: owner.organizationId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(GiftCardsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post(`/gift-cards/${giftCardId}/adjust`)
          .send({});
        expect(res.status).toBe(400);
      } finally {
        await h?.close();
      }
    });

    it('adjust with amountCents: 0 → 400 (zero adjustment forbidden)', async () => {
      const owner = await seedOrgWithMember('owner');
      const giftCardId = await seedGiftCard({
        organizationId: owner.organizationId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(GiftCardsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post(`/gift-cards/${giftCardId}/adjust`)
          .send({ amountCents: 0 });
        expect(res.status).toBe(400);
      } finally {
        await h?.close();
      }
    });
  });
});
