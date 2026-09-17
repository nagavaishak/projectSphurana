import { db, organization } from '@borradh-workspace/database';
import { APP_PIPE } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
/**
 * CHARACTERIZATION — OrganizationController
 * (apps/api/src/organization/organization.controller.ts).
 *
 * ⚠ READ THIS BEFORE TRUSTING THIS FILE AS A REFACTOR NET ⚠
 *
 * All four of this controller's handlers begin by resolving the active org
 * through BETTER AUTH (`getActiveOrganization(auth.api, { sessionToken })` /
 * `setActiveOrganization(auth.api, …)`). Neither half of that is available in
 * the integration harness:
 *
 *   1. `jest.integration.config.ts` maps `@borradh-workspace/auth/server` to
 *      `src/_integration/__mocks__/auth-server.ts`, a stub that exposes ONLY
 *      `api.getSession`. `api.getFullOrganization` / `api.setActiveOrganization`
 *      are undefined, so the feature services throw, catch, and return
 *      INTERNAL_ERROR → HTTP 500.
 *   2. Even with a real better-auth, `harness.ts`'s FakeAuthGuard hardcodes
 *      `req.sessionToken = 'test-session-token'`, which is not a signed session
 *      cookie, so better-auth would answer 401.
 *
 * Consequently the org-resolving BODY of `getActive` (calendar-settings
 * enrichment), `updateActive` (the settings write), `getOnboardingTasksStatus`
 * and `completeOnboardingTaskStatus` (the task write) IS NOT COVERED by this
 * file, and no test here would fail if that logic were dropped. That is a
 * harness limitation, not a decision to skip — it is reported as a finding
 * rather than papered over with a mock (this suite's rule is: no mocks).
 *
 * What IS pinned below is everything that executes BEFORE the auth boundary,
 * plus the boundary's own failure mapping:
 *   a. the AdminGuard role boundary on PATCH /organization/active (REAL guard,
 *      real `member` rows);
 *   b. DTO validation on both POST bodies (class-validator + nestjs-zod);
 *   c. that a failure at the auth boundary surfaces as 500 and writes NOTHING
 *      to Postgres — i.e. the handlers fail closed rather than falling back to
 *      some other organization.
 *
 * If the auth stub is ever taught `getFullOrganization`, (c) will start failing
 * — which is the signal to replace it with real end-to-end coverage.
 */
import { AdminGuard } from '../common/guards/admin.guard.js';
import { OrganizationController } from '../organization/organization.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';

const BAD_REQUEST = 400;
const FORBIDDEN = 403;
const INTERNAL_ERROR = 500;

const guards = [AdminGuard];

const readOrg = async (id: string) =>
  db.query.organization.findFirst({ where: eq(organization.id, id) });

describe('CHARACTERIZATION — organization controller', () => {
  describe('PATCH /organization/active — AdminGuard boundary (real guard)', () => {
    it('a plain member is refused → 403, before the handler runs', async () => {
      // Protects: the @UseGuards(AdminGuard) on updateActive. The guard reads
      // the real `member` row; a 'member' role has no admin access. This must
      // survive the move of the handler body into a use case.
      const owner = await seedOrgWithMember('owner');
      const plain = await seedOrgWithMember('member', {
        organizationId: owner.organizationId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(
          OrganizationController,
          { userId: plain.userId, organizationId: plain.organizationId },
          guards
        );
        const res = await request(h.app.getHttpServer())
          .patch('/organization/active')
          .send({ name: 'Renamed by a member' });
        expect(res.status).toBe(FORBIDDEN);

        // …and the org really was not renamed.
        const row = await readOrg(owner.organizationId);
        expect(row?.name).not.toBe('Renamed by a member');
      } finally {
        await h?.close();
      }
    });

    it('a user with no active organization is refused → 403', async () => {
      // Protects: AdminGuard's "authentication AND organization context
      // required" precondition — no active org is a 403, not a 500.
      const owner = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(
          OrganizationController,
          { userId: owner.userId, organizationId: undefined },
          guards
        );
        const res = await request(h.app.getHttpServer())
          .patch('/organization/active')
          .send({ name: 'Nowhere' });
        expect(res.status).toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('an owner clears the guard and is stopped only by the auth boundary', async () => {
      // Protects: the guard ordering — owner passes AdminGuard, so the request
      // reaches the handler, which then fails at the better-auth call (see the
      // header). The point of the assertion is the 403→non-403 transition: a
      // refactor that accidentally widened or narrowed the guard changes this.
      const owner = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(
          OrganizationController,
          { userId: owner.userId, organizationId: owner.organizationId },
          guards
        );
        const res = await request(h.app.getHttpServer())
          .patch('/organization/active')
          .send({ name: 'Renamed by the owner' });
        expect(res.status).not.toBe(FORBIDDEN);
        expect(res.status).toBe(INTERNAL_ERROR);

        // Fail-closed: nothing was written even though the caller was allowed.
        const row = await readOrg(owner.organizationId);
        expect(row?.name).not.toBe('Renamed by the owner');
      } finally {
        await h?.close();
      }
    });

    it('an invalid settings body → 400 from the zod DTO, never reaching the handler', async () => {
      // Protects: UpdateOrganizationSettingsDto validation (hex colour, URL and
      // non-negative-integer rules) running after the guards and before the
      // handler — 400 must win over the 500 the auth boundary would otherwise
      // produce.
      //
      // NOTE ON THE PIPE: UpdateOrganizationSettingsDto is a nestjs-zod
      // `createZodDto` class, which the method's own
      // `@UsePipes(new ValidationPipe(...))` (class-validator) CANNOT validate —
      // it carries no class-validator metadata. What validates it in production
      // is the GLOBAL `new ZodValidationPipe()` registered in main.ts. The
      // harness does not register that, so it is supplied here via APP_PIPE to
      // reproduce the deployed pipeline. Without it these bodies sail through to
      // the handler and 500 at the auth boundary — see the report's findings.
      const admin = await seedOrgWithMember('admin');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(
          OrganizationController,
          { userId: admin.userId, organizationId: admin.organizationId },
          [...guards, { provide: APP_PIPE, useClass: ZodValidationPipe }]
        );
        const server = h.app.getHttpServer();

        const badColor = await request(server)
          .patch('/organization/active')
          .send({ primaryColor: 'not-a-hex-colour' });
        expect(badColor.status).toBe(BAD_REQUEST);

        const badUrl = await request(server)
          .patch('/organization/active')
          .send({ websiteUrl: 'definitely not a url' });
        expect(badUrl.status).toBe(BAD_REQUEST);

        const badDeposit = await request(server)
          .patch('/organization/active')
          .send({ depositAmount: -5 });
        expect(badDeposit.status).toBe(BAD_REQUEST);
      } finally {
        await h?.close();
      }
    });
  });

  describe('POST /organization/active — DTO validation', () => {
    it('an empty body → 400 ("Organization ID is required")', async () => {
      // Protects: SetActiveOrganizationDto (@IsString + @MinLength(1)) is
      // enforced by the method-level ValidationPipe before any auth call.
      const owner = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const empty = await request(server)
          .post('/organization/active')
          .send({});
        expect(empty.status).toBe(BAD_REQUEST);
        expect(JSON.stringify(empty.body.message)).toContain(
          'Organization ID is required'
        );

        const blank = await request(server)
          .post('/organization/active')
          .send({ organizationId: '' });
        expect(blank.status).toBe(BAD_REQUEST);
      } finally {
        await h?.close();
      }
    });

    it('a well-formed body is refused at the auth boundary → 500, no session change', async () => {
      // Protects: the failure mapping of setActiveOrganization. NOT coverage of
      // the happy path (unreachable — see the file header).
      const owner = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/organization/active')
          .send({ organizationId: owner.organizationId });
        expect(res.status).toBe(INTERNAL_ERROR);
      } finally {
        await h?.close();
      }
    });
  });

  describe('POST /organization/onboarding-tasks/complete — DTO validation', () => {
    it('an unknown taskId → 400 ("Invalid task ID") before any DB write', async () => {
      // Protects: CompleteOnboardingTaskDto's @IsIn(onboardingTaskValues) gate.
      // A bad task id must never reach completeOnboardingTask.
      const owner = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const bad = await request(server)
          .post('/organization/onboarding-tasks/complete')
          .send({ taskId: 'not-a-real-task' });
        expect(bad.status).toBe(BAD_REQUEST);
        expect(JSON.stringify(bad.body.message)).toContain('Invalid task ID');

        const missing = await request(server)
          .post('/organization/onboarding-tasks/complete')
          .send({});
        expect(missing.status).toBe(BAD_REQUEST);
      } finally {
        await h?.close();
      }
    });
  });

  describe('the better-auth boundary (documented limitation)', () => {
    it('GET /organization/active and GET /organization/onboarding-tasks both fail closed → 500', async () => {
      // Protects: neither read route invents an organization when the session
      // cannot be resolved — no fallback to the request's activeOrganizationId,
      // no empty-200. They surface the error (mapErrorToHttpException default
      // branch). The enrichment/task-listing logic itself is NOT covered here.
      const owner = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        expect((await request(server).get('/organization/active')).status).toBe(
          INTERNAL_ERROR
        );
        expect(
          (await request(server).get('/organization/onboarding-tasks')).status
        ).toBe(INTERNAL_ERROR);
      } finally {
        await h?.close();
      }
    });
  });
});
