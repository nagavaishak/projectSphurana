/**
 * Fresha domain — appointment deposits, asserted over HTTP against a real DB.
 * Exercises the real Nest HTTP pipeline + real feature services + real SQL,
 * with only the AuthGuard faked (identity stamped by the harness).
 *
 * Scope: the dedicated DepositsController (`/deposits`) and ONLY its deposit
 * routes. The appointment-BOOKING flow (create/update-appointment,
 * submit-general-booking) is deliberately untouched here — another window owns
 * it. Deposits reference an appointment, but we seed those rows directly rather
 * than driving the booking-create endpoint.
 *
 * Routes covered (all @UseGuards(AuthGuard) only — no RoleGuard, no per-role
 * gate; the enforced rule is org-scope, exactly like the timesheets exemplar):
 *   POST   /deposits                 create a deposit request  (DTO validation)
 *   GET    /deposits                 list  → { items, total, limit, offset }
 *   GET    /deposits/:id             get by deposit id (bare row)
 *   GET    /deposits/appointment/:id get by appointment id (bare row)
 *   POST   /deposits/:id/cancel      pending → cancelled (state transition)
 *   POST   /deposits/:id/refund      paid → refunded (guard path only, below)
 *
 * Facets proven end to end:
 *
 *   a. LIST + ORG ISOLATION — the list, run as an org-A member, returns only
 *      org-A deposits; a cross-org GET-by-id of an org-B deposit → 404 (the
 *      getDeposit WHERE clause is `id AND organizationId`).
 *   b. STATE TRANSITION (no Stripe) — cancel-deposit moves a `pending` deposit
 *      to `cancelled`. We seed the pending deposit WITHOUT a checkout-session id
 *      so the service takes its no-Stripe branch (it only calls Stripe to expire
 *      an EXISTING session). We then read the row back and assert `cancelled`.
 *   c. STATE GUARDS (no fabricated Stripe) —
 *        · cancel on a non-pending (paid) deposit → 400 (INVALID_STATE).
 *        · refund on a pending deposit → 400 (INVALID_STATE) — refund strictly
 *          requires a live Stripe charge (a `paid` deposit + payment intent),
 *          so instead of faking a Stripe success we pin its wrong-state GUARD.
 *          The happy refund path (which calls stripe.createRefund) is left to
 *          the unit tests with a mocked Stripe client. See NOTE below.
 *   d. DTO VALIDATION — POST /deposits with an empty body → 400 (appointmentId,
 *      amountCents, successUrl, cancelUrl are all required by the create schema).
 *
 * NOTE (skipped path): the create endpoint (POST /deposits) and the happy
 * refund path both make outbound Stripe Connect calls (checkout-session /
 * refund creation) that this harness has no way to satisfy without a live
 * Stripe account. Per the task's no-fabrication rule, those success paths are
 * NOT exercised here; we assert their validation/guard paths instead.
 */
import { db } from '@borradh-workspace/database';
import { handleDepositWebhook } from '@borradh-workspace/features/appointments';
import request from 'supertest';
import { DepositsController } from '../deposits/deposits.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';
import { seedDeposit } from './seeds/deposits.js';

describe('Fresha domain — appointment deposits (HTTP)', () => {
  describe('list + org isolation', () => {
    it('list returns only org-A deposits; cross-org GET :id → 404', async () => {
      const orgA = await seedOrgWithMember('member');
      const orgB = await seedOrgWithMember('member');

      const a1 = await seedDeposit({
        organizationId: orgA.organizationId,
        assignedToId: orgA.userId,
        amountCents: 5000,
      });
      const a2 = await seedDeposit({
        organizationId: orgA.organizationId,
        assignedToId: orgA.userId,
        amountCents: 7500,
      });
      const b1 = await seedDeposit({
        organizationId: orgB.organizationId,
        assignedToId: orgB.userId,
        amountCents: 9000,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(DepositsController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const server = h.app.getHttpServer();

        // list is org-scoped: only org-A deposits, never org-B's
        const list = await request(server).get('/deposits');
        expect(list.status).toBe(200);
        const ids = list.body.items.map((d: { id: string }) => d.id).sort();
        expect(ids).toEqual([a1, a2].sort());
        expect(ids).not.toContain(b1);
        expect(list.body.total).toBe(2);

        // org A's own deposit IS reachable by id
        const own = await request(server).get(`/deposits/${a1}`);
        expect(own.status).toBe(200);
        expect(own.body.id).toBe(a1);
        expect(own.body.organizationId).toBe(orgA.organizationId);

        // org A reading org B's deposit → 404 (WHERE id AND organizationId)
        const cross = await request(server).get(`/deposits/${b1}`);
        expect(cross.status).toBe(404);
      } finally {
        await h?.close();
      }
    });
  });

  describe('state transition — cancel (no Stripe)', () => {
    it('cancel a pending deposit → cancelled, and the row reflects it', async () => {
      const owner = await seedOrgWithMember('owner');
      const depositId = await seedDeposit({
        organizationId: owner.organizationId,
        assignedToId: owner.userId,
        status: 'pending',
        // no checkout-session id → service skips the Stripe expire call
        stripeCheckoutSessionId: null,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(DepositsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const cancel = await request(server).post(
          `/deposits/${depositId}/cancel`
        );
        expect([200, 201]).toContain(cancel.status);
        expect(cancel.body.success).toBe(true);

        // read the row back — status is now 'cancelled'
        const after = await request(server).get(`/deposits/${depositId}`);
        expect(after.status).toBe(200);
        expect(after.body.status).toBe('cancelled');
      } finally {
        await h?.close();
      }
    });
  });

  describe('state guards (no fabricated Stripe)', () => {
    it('cancel a non-pending (paid) deposit → 400 (INVALID_STATE)', async () => {
      const owner = await seedOrgWithMember('owner');
      const depositId = await seedDeposit({
        organizationId: owner.organizationId,
        assignedToId: owner.userId,
        status: 'paid',
        stripePaymentIntentId: `pi_${Date.now()}`,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(DepositsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer()).post(
          `/deposits/${depositId}/cancel`
        );
        expect(res.status).toBe(400);
      } finally {
        await h?.close();
      }
    });

    it('refund a pending deposit → 400 (INVALID_STATE, before any Stripe call)', async () => {
      const owner = await seedOrgWithMember('owner');
      const depositId = await seedDeposit({
        organizationId: owner.organizationId,
        assignedToId: owner.userId,
        status: 'pending',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(DepositsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        // refundDeposit guards on status === 'paid' BEFORE touching Stripe, so
        // a pending deposit fails the guard, never reaching stripe.createRefund.
        const res = await request(h.app.getHttpServer())
          .post(`/deposits/${depositId}/refund`)
          .send({});
        expect(res.status).toBe(400);
      } finally {
        await h?.close();
      }
    });

    it('cross-org cancel of an org-B deposit → 404', async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const bDeposit = await seedDeposit({
        organizationId: orgB.organizationId,
        assignedToId: orgB.userId,
        status: 'pending',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(DepositsController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const res = await request(h.app.getHttpServer()).post(
          `/deposits/${bDeposit}/cancel`
        );
        expect(res.status).toBe(404);
      } finally {
        await h?.close();
      }
    });
  });

  describe('refund via the no-Stripe branch (calendar/deposit-refund)', () => {
    it('a charge.refunded webhook moves a paid deposit to refunded', async () => {
      // The DepositsController /refund endpoint ALWAYS calls Stripe
      // (createRefund) for a paid deposit, so its happy path can't run in this
      // Stripe-less harness (its wrong-state guard is pinned above). The
      // no-Stripe refund path is the webhook the E2E drives via
      // /testing/simulate-stripe-webhook → handleDepositWebhook: on
      // `charge.refunded` it keys off stripePaymentIntentId and flips the
      // deposit to `refunded` with NO outbound Stripe call. We invoke that same
      // settlement service directly against the real test DB, then read the
      // transition back through the controller.
      const owner = await seedOrgWithMember('owner');
      const paymentIntentId = `pi_int_${Date.now()}`;
      const depositId = await seedDeposit({
        organizationId: owner.organizationId,
        assignedToId: owner.userId,
        status: 'paid',
        stripePaymentIntentId: paymentIntentId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(DepositsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        // precondition: the controller reads it as paid
        const before = await request(server).get(`/deposits/${depositId}`);
        expect(before.status).toBe(200);
        expect(before.body.status).toBe('paid');

        // drive the no-Stripe refund settlement (same path the webhook uses)
        const result = await handleDepositWebhook(db, {
          eventType: 'charge.refunded',
          paymentIntentId,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.processed).toBe(true);
          expect(result.data.action).toBe('refunded');
        }

        // the transition persisted — the controller now reads it as refunded
        const after = await request(server).get(`/deposits/${depositId}`);
        expect(after.status).toBe(200);
        expect(after.body.status).toBe('refunded');
        expect(after.body.refundedAt).not.toBeNull();
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
        h = await buildControllerApp(DepositsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/deposits')
          .send({});
        expect(res.status).toBe(400);
      } finally {
        await h?.close();
      }
    });
  });
});
