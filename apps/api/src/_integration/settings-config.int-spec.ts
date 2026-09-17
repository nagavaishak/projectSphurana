import request from 'supertest';
/**
 * Fresha domain — org settings / config persistence over HTTP (asserted against
 * a real DB).
 *
 * TARGET CONTROLLER: OrgDefaultsController (`/org-defaults`). This is the
 * harness-testable org settings surface — it resolves the org from the session
 * via `@ActiveOrganization()` (which the harness stamps) and persists the
 * per-org config that drives advertising, video, wage/scheduling and gift-card
 * (payment) behaviour.
 *
 * NOTE on the OTHER settings controller: OrganizationController's own settings
 * endpoints (`GET/PATCH /organization/active`) resolve the active org through
 * `getActiveOrganization(auth.api, { sessionToken })` — i.e. Better Auth, which
 * the harness fakes AT THE GUARD only (it does NOT stand up a real Better Auth
 * session). Those endpoints therefore cannot be driven by this harness, so the
 * equivalent settings persistence is asserted here through OrgDefaults, whose
 * `updateOrganizationSettings`-style write path (`updateOrgDefaults`) IS
 * exercised end to end.
 *
 * OrgDefaultsController carries @UseGuards(AuthGuard, RoleGuard); GET needs only
 * membership, PATCH declares @RequireRole('admin').
 *
 * Facets proven end to end:
 *   a. GET CURRENT CONFIG — a member reads `/org-defaults`; the service always
 *      succeeds, returning resolved values (system fallbacks fill unset fields)
 *      plus an `overrides` map. With no row yet, every override is `false` and
 *      values equal SYSTEM_DEFAULTS (adDailyBudgetCents 1000, brandVoice null).
 *   b. PATCH + READ-BACK (persists) — an admin sets a couple of fields; a fresh
 *      GET reads them back with `overrides.<field> === true`. A second PATCH
 *      clearing a field with `null` restores the system fallback and flips its
 *      override back to `false` (the documented null-clears semantics).
 *   c. ORG ISOLATION — these endpoints take NO org id in the path; the org comes
 *      from the session and both services filter `WHERE organizationId`. So an
 *      override written as org-A must be invisible to org-B: org-B's GET returns
 *      the system fallback with `overrides.<field> === false`, and org-A still
 *      sees its own value. (Explicit `eq(orgDefaults.organizationId, …)` in both
 *      get + update services — no RLS-only reliance here.)
 *   d. ROLE + DTO VALIDATION — a plain member PATCHing → 403 (@RequireRole
 *      'admin'); an admin PATCHing an invalid value (negative budget) → 400.
 *
 * This controller has no soft/hard delete route — there is nothing to delete;
 * `null` on a PATCH is the "clear" operation and is asserted under (b).
 */
import { OrgDefaultsController } from '../org-defaults/org-defaults.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';

describe('Fresha domain — org settings / config (HTTP)', () => {
  describe('get current config', () => {
    it('member reads resolved defaults + overrides map (no row yet)', async () => {
      const member = await seedOrgWithMember('member');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrgDefaultsController, {
          userId: member.userId,
          organizationId: member.organizationId,
        });
        const res = await request(h.app.getHttpServer()).get('/org-defaults');
        expect(res.status).toBe(200);
        // Resolved from SYSTEM_DEFAULTS when no org row exists.
        expect(res.body.adDailyBudgetCents).toBe(1000);
        expect(res.body.adObjective).toBe('OUTCOME_LEADS');
        expect(res.body.brandVoice).toBeNull();
        // Nothing overridden yet.
        expect(res.body.overrides.adDailyBudgetCents).toBe(false);
        expect(res.body.overrides.brandVoice).toBe(false);
      } finally {
        await h?.close();
      }
    });
  });

  describe('patch + read-back (persists)', () => {
    it('admin sets fields → fresh GET reads them back with overrides true', async () => {
      const admin = await seedOrgWithMember('admin');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrgDefaultsController, {
          userId: admin.userId,
          organizationId: admin.organizationId,
        });
        const server = h.app.getHttpServer();

        const patch = await request(server)
          .patch('/org-defaults')
          .send({ adDailyBudgetCents: 2500, brandVoice: 'Playful and warm' });
        expect(patch.status).toBe(200);
        // PATCH returns the freshly resolved config (controller re-reads).
        expect(patch.body.adDailyBudgetCents).toBe(2500);
        expect(patch.body.brandVoice).toBe('Playful and warm');
        expect(patch.body.overrides.adDailyBudgetCents).toBe(true);
        expect(patch.body.overrides.brandVoice).toBe(true);

        // Independent GET proves it persisted (not just echoed).
        const get = await request(server).get('/org-defaults');
        expect(get.status).toBe(200);
        expect(get.body.adDailyBudgetCents).toBe(2500);
        expect(get.body.brandVoice).toBe('Playful and warm');
        expect(get.body.overrides.adDailyBudgetCents).toBe(true);
      } finally {
        await h?.close();
      }
    });

    it('PATCH with null clears the override → falls back to system default', async () => {
      const admin = await seedOrgWithMember('admin');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrgDefaultsController, {
          userId: admin.userId,
          organizationId: admin.organizationId,
        });
        const server = h.app.getHttpServer();

        // Set then clear adDailyBudgetCents.
        await request(server)
          .patch('/org-defaults')
          .send({ adDailyBudgetCents: 4200 });
        const cleared = await request(server)
          .patch('/org-defaults')
          .send({ adDailyBudgetCents: null });
        expect(cleared.status).toBe(200);
        expect(cleared.body.adDailyBudgetCents).toBe(1000); // system fallback
        expect(cleared.body.overrides.adDailyBudgetCents).toBe(false);
      } finally {
        await h?.close();
      }
    });
  });

  describe('org isolation (session-scoped, WHERE organizationId)', () => {
    it("org-A's override is invisible to org-B; org-A still sees its own", async () => {
      const orgA = await seedOrgWithMember('admin');
      const orgB = await seedOrgWithMember('admin');

      let hA: IntegrationApp | undefined;
      let hB: IntegrationApp | undefined;
      try {
        hA = await buildControllerApp(OrgDefaultsController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const serverA = hA.app.getHttpServer();

        const patchA = await request(serverA)
          .patch('/org-defaults')
          .send({ brandVoice: 'Org A voice', adDailyBudgetCents: 7777 });
        expect(patchA.status).toBe(200);

        // org B reads its OWN config — must NOT see org A's override.
        hB = await buildControllerApp(OrgDefaultsController, {
          userId: orgB.userId,
          organizationId: orgB.organizationId,
        });
        const getB = await request(hB.app.getHttpServer()).get('/org-defaults');
        expect(getB.status).toBe(200);
        expect(getB.body.brandVoice).toBeNull();
        expect(getB.body.adDailyBudgetCents).toBe(1000);
        expect(getB.body.overrides.brandVoice).toBe(false);
        expect(getB.body.overrides.adDailyBudgetCents).toBe(false);

        // org A still sees its own persisted override.
        const getA = await request(serverA).get('/org-defaults');
        expect(getA.body.brandVoice).toBe('Org A voice');
        expect(getA.body.adDailyBudgetCents).toBe(7777);
      } finally {
        await hA?.close();
        await hB?.close();
      }
    });
  });

  describe('role + DTO validation', () => {
    it('a plain member PATCHing → 403 (@RequireRole admin)', async () => {
      const member = await seedOrgWithMember('member');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrgDefaultsController, {
          userId: member.userId,
          organizationId: member.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .patch('/org-defaults')
          .send({ adDailyBudgetCents: 3000 });
        expect(res.status).toBe(403);
      } finally {
        await h?.close();
      }
    });

    it('an admin PATCHing an invalid value (negative budget) → 400', async () => {
      const admin = await seedOrgWithMember('admin');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrgDefaultsController, {
          userId: admin.userId,
          organizationId: admin.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .patch('/org-defaults')
          .send({ adDailyBudgetCents: -100 });
        expect(res.status).toBe(400);
      } finally {
        await h?.close();
      }
    });
  });
});
