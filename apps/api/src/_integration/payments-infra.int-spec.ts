import request from 'supertest';
/**
 * PAYMENTS-INFRA — Stripe Connect + Terminal controllers (WIRING, asserted over
 * HTTP against a real DB).
 *
 * These controllers ultimately talk to Stripe. Stripe itself is NOT exercised
 * here (no network, no keys). The integration value we CAN prove without Stripe
 * is the request WIRING that runs BEFORE any Stripe call:
 *
 *   - the `requireActiveOrganization` inline guard (missing active org → 400),
 *   - method-level ValidationPipe on the two POST bodies (malformed/empty → 400,
 *     which short-circuits before the service — the role-boundaries technique),
 *   - the DB-only status branch (`getStripeConnectStatus`) for a fresh org,
 *   - the Terminal `requireConnectedAccount` gate (`getStripeConnection` DB read
 *     → null → 400) for an org with no Stripe Connect row.
 *
 * Both `getStripeConnectStatus` and `getStripeConnection` are pure DB reads (no
 * Stripe SDK), verified by reading the services — so those branches are safe to
 * assert end to end. Any branch that reaches `createAccountSession` /
 * `createAccountLink` / `refreshStripeAccount` / `createTerminalConnectionToken`
 * would hit real Stripe and is deliberately NOT asserted here (see notes).
 *
 * Both controllers carry only `@UseGuards(AuthGuard)` (no RoleGuard), so no
 * `member` row is needed to reach these paths; the harness stamps identity.
 */
import { IntegrationsStripeController } from '../integrations/stripe/stripe.controller.js';
import { TerminalController } from '../terminal/terminal.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
  seedUser,
} from './harness.js';
import { seedStripeConnectIntegration } from './seeds/payments-infra.js';

const BAD_REQUEST = 400;

describe('Payments-infra — Stripe Connect + Terminal (HTTP)', () => {
  /* ---------------------------------------------------------------- */
  /* requireActiveOrganization — no active org → 400 (before Stripe). */
  /* ---------------------------------------------------------------- */
  describe('no active organization → 400', () => {
    it('GET /integrations/stripe/account-status', async () => {
      const u = await seedUser();
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(IntegrationsStripeController, {
          userId: u.id,
          organizationId: undefined,
        });
        const res = await request(h.app.getHttpServer()).get(
          '/integrations/stripe/account-status'
        );
        expect(res.status).toBe(BAD_REQUEST);
      } finally {
        await h?.close();
      }
    });

    it('POST /terminal/connection-token', async () => {
      const u = await seedUser();
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(TerminalController, {
          userId: u.id,
          organizationId: undefined,
        });
        const res = await request(h.app.getHttpServer()).post(
          '/terminal/connection-token'
        );
        expect(res.status).toBe(BAD_REQUEST);
      } finally {
        await h?.close();
      }
    });
  });

  /* ---------------------------------------------------------------- */
  /* ValidationPipe on the POST bodies rejects BEFORE any Stripe call.*/
  /* ---------------------------------------------------------------- */
  describe('DTO validation → 400 (short-circuits before Stripe)', () => {
    it('account-session with a malformed body (components not an array) → 400', async () => {
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(IntegrationsStripeController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        // `components` is an optional string[]; a string fails the schema, so
        // the method ValidationPipe 400s before createAccountSession() runs.
        const res = await request(h.app.getHttpServer())
          .post('/integrations/stripe/account-session')
          .send({ components: 'account_onboarding' });
        expect(res.status).toBe(BAD_REQUEST);
      } finally {
        await h?.close();
      }
    });

    it('account-link with an empty body → 400 (returnUrl/refreshUrl required)', async () => {
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(IntegrationsStripeController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/integrations/stripe/account-link')
          .send({});
        expect(res.status).toBe(BAD_REQUEST);
      } finally {
        await h?.close();
      }
    });

    it('account-link with malformed URLs → 400', async () => {
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(IntegrationsStripeController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/integrations/stripe/account-link')
          .send({ returnUrl: 'not-a-url', refreshUrl: 'also-bad' });
        expect(res.status).toBe(BAD_REQUEST);
      } finally {
        await h?.close();
      }
    });
  });

  /* ---------------------------------------------------------------- */
  /* account-status — DB-only branch (no Stripe call).                */
  /* ---------------------------------------------------------------- */
  describe('GET account-status — DB-only (no Stripe call)', () => {
    it('fresh org with NO connected account → 200 { connected: false, ... }', async () => {
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(IntegrationsStripeController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer()).get(
          '/integrations/stripe/account-status'
        );
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          connected: false,
          accountType: null,
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
          requirementsCurrentlyDue: [],
          disabledReason: null,
        });
      } finally {
        await h?.close();
      }
    });

    it('org WITH a seeded connect row → 200 { connected: true, ... } (mirrors persisted state, still no Stripe)', async () => {
      const owner = await seedOrgWithMember('owner');
      await seedStripeConnectIntegration({
        organizationId: owner.organizationId,
        accountType: 'controller',
        chargesEnabled: true,
        detailsSubmitted: true,
        requirementsCurrentlyDue: ['external_account'],
      });
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(IntegrationsStripeController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer()).get(
          '/integrations/stripe/account-status'
        );
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          connected: true,
          accountType: 'controller',
          chargesEnabled: true,
          payoutsEnabled: false,
          detailsSubmitted: true,
          requirementsCurrentlyDue: ['external_account'],
        });
      } finally {
        await h?.close();
      }
    });

    it('account-status is org-scoped — org A does not see org B connect row', async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      await seedStripeConnectIntegration({
        organizationId: orgB.organizationId,
        chargesEnabled: true,
      });
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(IntegrationsStripeController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const res = await request(h.app.getHttpServer()).get(
          '/integrations/stripe/account-status'
        );
        expect(res.status).toBe(200);
        expect(res.body.connected).toBe(false);
      } finally {
        await h?.close();
      }
    });
  });

  /* ---------------------------------------------------------------- */
  /* Terminal connection-token — requireConnectedAccount gate.        */
  /* getStripeConnection is a DB read; a null/inactive row 400s BEFORE */
  /* getStripeConnectService()/Stripe is ever touched.                */
  /* ---------------------------------------------------------------- */
  describe('POST /terminal/connection-token — connected-account gate (before Stripe)', () => {
    it('org with NO Stripe Connect row → 400 (not connected)', async () => {
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(TerminalController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer()).post(
          '/terminal/connection-token'
        );
        expect(res.status).toBe(BAD_REQUEST);
      } finally {
        await h?.close();
      }
    });

    it('org with an INACTIVE Stripe Connect row → 400 (not connected)', async () => {
      const owner = await seedOrgWithMember('owner');
      await seedStripeConnectIntegration({
        organizationId: owner.organizationId,
        isActive: false,
      });
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(TerminalController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer()).post(
          '/terminal/connection-token'
        );
        expect(res.status).toBe(BAD_REQUEST);
      } finally {
        await h?.close();
      }
    });
  });

  /* ----------------------------------------------------------------
   * Happy paths are NOT asserted in this file, but they ARE covered — see
   * stripe-connect-stub.int-spec.ts (account-session incl. lazy controller
   * provisioning, and account-link).
   *
   * This note used to say those calls "would hit REAL Stripe" and had to be
   * left to unit/e2e coverage. That was true, but only because of a BUG:
   * StripeConnectStubService had no override for them, so under
   * STRIPE_E2E_STUB they ran the real implementation against a dummy key
   * (~1200 preview errors, 2026-07-11 → 08-19). With the stub complete they
   * are ordinary integration tests, and the sibling file asserts them.
   *
   * Still genuinely uncovered here:
   *   - POST account-refresh: calls refreshStripeAccount() → Stripe.
   *   - POST /terminal/connection-token for an ACTIVE connected account.
   * Both are stubbed now, so either could move into the sibling file when
   * someone needs the coverage; they simply have no assertion written yet.
   * ---------------------------------------------------------------- */
});
