import { createHmac, randomUUID } from 'node:crypto';
import { auth, symmetricEncrypt } from '@borradh-workspace/auth/server';
import {
  and,
  db,
  desc,
  eq,
  inArray,
  like,
  lt,
  runWithRlsContext,
  sql,
  withSystemScope,
} from '@borradh-workspace/database';
import {
  account,
  appointment,
  asset,
  contentAttempt,
  contentBatch,
  conversation,
  conversationMessage,
  graphic,
  member,
  metaAdsIntegration,
  metaAdsPage,
  organization,
  organizationLocation,
  stripeConnectIntegration,
  subscriptions,
  twoFactor,
  user,
  verification,
  video,
  whatsappAccount,
} from '@borradh-workspace/database/schema';
import { apiEnv } from '@borradh-workspace/env/api';
import { authEnv } from '@borradh-workspace/env/auth';
import {
  buildManageBookingUrl,
  createAppointment,
  issueManageToken,
  resolveMicrositeLinkTarget,
} from '@borradh-workspace/features/appointments';
import {
  createConversation,
  resolveOwnerByPhone,
} from '@borradh-workspace/features/assistant';
import { signIn, signUp } from '@borradh-workspace/features/auth';
import { generateMonthlyBatch } from '@borradh-workspace/features/content-batches';
import {
  handleIncomingMessage,
  sendLeadFirstTouch,
  sendLeadFollowUp,
} from '@borradh-workspace/features/conversations';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import { fetchWithTimeout } from '@borradh-workspace/http';
import {
  GRAPH_API_BASE,
  encryptCredentials,
} from '@borradh-workspace/integrations';
import type { AssetSource } from '@borradh-workspace/labels';
import { businessTypeValues } from '@borradh-workspace/labels';
import { logError } from '@borradh-workspace/observability';
import { getRedis } from '@borradh-workspace/redis';
import {
  copyFromUrl,
  getPublicAssetsBucket,
  getS3Region,
} from '@borradh-workspace/storage';
import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  type HeadlessTurnToolCall,
  type RunHeadlessTurnResult,
  runHeadlessTurn,
} from '../assistant/index.js';
import {
  type ClaireWhatsappTurnResult,
  processClaireWhatsappTurn,
} from '../chatbot-worker/claire-whatsapp-turn.process.js';

/**
 * Input schema for createOrg. Mirrors the minimal subset of
 * createOrganizationSchema that a pure-API org provisioner needs — a name and
 * a valid businessType, plus the existing user to own it. Validating here (not
 * just trusting the body) gives the endpoint a real VALIDATION_ERROR path:
 * a bad businessType or empty name is rejected before any DB write, the same
 * way every feature service validates with Zod first.
 */
const createOrgSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  name: z.string().min(1, 'name is required').max(100, 'name too long'),
  businessType: z.enum(businessTypeValues).optional(),
});

export type CreateOrgInput = z.infer<typeof createOrgSchema>;

/**
 * Where `cloneFixture` writes. Separate from the durable `e2e/` fixtures on
 * purpose: everything under here is a per-run throwaway that a spec's teardown
 * is EXPECTED to delete.
 */
const E2E_EPHEMERAL_PREFIX = 'e2e/ephemeral/';

/** The durable fixture prefix a clone may be sourced from. Nothing else. */
const E2E_FIXTURE_PREFIX = 'e2e/';

const cloneFixtureSchema = z.object({
  sourceUrl: z.string().url('sourceUrl must be a URL'),
});

/**
 * Testing service for E2E test data management.
 * All test data is prefixed with 'e2e_test_' for easy identification and cleanup.
 */
@Injectable()
export class TestingService {
  private readonly logger = new Logger(TestingService.name);
  private readonly E2E_PREFIX = 'e2e_test_';

  /**
   * Generate a unique E2E test ID
   */
  private generateId(): string {
    return `${this.E2E_PREFIX}${randomUUID()}`;
  }

  /**
   * Create a session for a test user via Better Auth.
   * Returns the session token for direct use in storageState.
   */
  /**
   * Provision a complete, ready-to-use org in ONE server-side call.
   *
   * WHY THIS EXISTS. Every `tabs` test provisions its own org, and it used to do
   * that over FOUR HTTP round trips from the runner: POST /auth/sign-up →
   * force-verify → POST /testing/create-session (a full sign-IN) → create-org.
   * Two of those hash a password (sign-up and sign-in both run the KDF, which is
   * deliberately CPU-expensive), and the suites run ~26 workers concurrently.
   * The result was a steady drip of `API sign-up failed (500)` and
   * `Failed to create session: Invalid email or password` — the latter being the
   * sign-up/sign-in race, where sign-in ran before the new user was readable.
   * That was the single biggest source of flake in the tabs job (25 flaky in the
   * last run) and it is pure harness cost, unrelated to anything under test.
   *
   * Doing it all in-process collapses that to ONE request: no network hop between
   * the steps, so the race cannot happen, and the KDF runs once (sign-up) instead
   * of twice — the session is minted directly rather than by signing in again.
   *
   * Idempotent-ish by construction: the caller passes a unique email per test.
   */
  /**
   * Serialises org provisioning to a handful at a time.
   *
   * Sign-up runs a password KDF, which is CPU-bound BY DESIGN. The suites run
   * ~26 Playwright workers, so without a gate ~30 KDFs land at once on a
   * shared-CPU preview box, the event loop stalls, and in-flight DB queries then
   * blow their statement timeout — surfacing as
   * `Sign-up failed: An error occurred while creating your account` and raw
   * `Failed query: insert into "subscriptions"`. Reproduced exactly: 8 concurrent
   * provisions all succeed; 30 concurrent produce 19 sign-up failures plus a DB
   * error.
   *
   * The requests are not too many — they are merely too SIMULTANEOUS. A queue
   * turns a burst into a line: callers wait a beat instead of failing, and the
   * API stays responsive for the suites running alongside. The e2e client allows
   * 60s, far beyond what this costs.
   */
  private static provisionGate: Promise<unknown> = Promise.resolve();
  private static provisionInFlight = 0;
  private static readonly MAX_CONCURRENT_PROVISIONS = 4;

  private async withProvisionSlot<T>(fn: () => Promise<T>): Promise<T> {
    while (
      TestingService.provisionInFlight >=
      TestingService.MAX_CONCURRENT_PROVISIONS
    ) {
      await TestingService.provisionGate;
    }
    TestingService.provisionInFlight += 1;
    const run = fn().finally(() => {
      TestingService.provisionInFlight -= 1;
    });
    // Anyone waiting above wakes when the current batch settles.
    TestingService.provisionGate = run.catch(() => undefined);
    return run;
  }

  async provisionOrg(input: {
    email: string;
    password: string;
    name: string;
    orgName: string;
    businessType?: string;
  }): Promise<{
    success: boolean;
    message: string;
    data?: {
      userId: string;
      organizationId: string;
      sessionToken: string;
    };
  }> {
    return this.withProvisionSlot(() => this.provisionOrgImpl(input));
  }

  private async provisionOrgImpl(input: {
    email: string;
    password: string;
    name: string;
    orgName: string;
    businessType?: string;
  }): Promise<{
    success: boolean;
    message: string;
    data?: {
      userId: string;
      organizationId: string;
      sessionToken: string;
    };
  }> {
    try {
      // provisionOrg is IDEMPOTENT and safe to call repeatedly / concurrently.
      // The shared preview DB (`preview-shared`) is reset on merge and re-seeded
      // lazily by whichever PR preview runs first afterwards — and several
      // previews can race to seed the SAME fixed account at once. So "already
      // exists" is a normal, successful outcome: rather than failing on a
      // duplicate, we converge to the desired end state (verified user +
      // verified org + subscription + session) whether the account was just
      // created or already there.

      // Sign-up may fail because the email already exists (a prior seed, or a
      // concurrent provisioner that won the race) — that is NOT fatal, the steps
      // below reconcile the existing account. Any OTHER sign-up failure IS fatal:
      // the old code treated ANY failure as "already exists, reconcile it" and
      // barrelled on to `forceVerifyUser`, which does `UPDATE user WHERE email`,
      // finds no row, and returns the misleading `User not found: <email>` — the
      // real cause (e.g. an E2E email whose local-part exceeds 64 chars, which
      // #639's validator DETERMINISTICALLY rejects) was hidden. So distinguish
      // the two and surface the real error immediately, BEFORE forceVerifyUser.
      const signUpResult = await signUp(auth.api, {
        name: input.name,
        email: input.email,
        password: input.password,
      });

      if (!signUpResult.success) {
        const isDuplicate =
          signUpResult.error.code === ErrorCodes.ALREADY_EXISTS ||
          /already exists/i.test(signUpResult.error.message);

        if (!isDuplicate) {
          // Fail LOUDLY with the real sign-up error rather than proceeding to a
          // certain `User not found` in forceVerifyUser.
          const message = `provisionOrg: sign-up failed for ${input.email}: ${signUpResult.error.message}`;
          this.logger.error(message);
          return { success: false, message };
        }

        this.logger.log(
          `provisionOrg: sign-up for ${input.email} created no new user (${signUpResult.error.message}); reconciling the existing account.`
        );
      }

      // Verify the email (idempotent — keyed on email).
      const verified = await this.forceVerifyUser(input.email);
      if (!verified.success) {
        return { success: false, message: verified.message };
      }

      // The session doubles as the existence + password gate: if the user
      // genuinely does not exist (a real sign-up failure, not a duplicate), this
      // fails and we surface it. Otherwise it mints a session WITHOUT a second
      // KDF pass.
      const session = await this.createSession(input.email, input.password);
      if (!session.success || !session.token || !session.user) {
        return {
          success: false,
          message: `Session creation failed: ${session.message}`,
        };
      }

      // Reuse the user's existing org if they already have one; only create when
      // missing. This is what makes a re-seed a no-op instead of stacking
      // duplicate orgs on the same user.
      let organizationId: string;
      const existing = await this.getOrganizationByEmail(input.email);
      if (existing.success && existing.organizationId) {
        organizationId = existing.organizationId;
      } else {
        const org = await this.createOrg({
          userId: session.user.id,
          name: input.orgName,
          ...(input.businessType ? { businessType: input.businessType } : {}),
        });
        if (!org.success || !org.data) {
          return { success: false, message: org.message };
        }
        organizationId = org.data.organizationId;

        const orgVerified = await this.forceVerifyOrganization(organizationId);
        if (!orgVerified.success) {
          return { success: false, message: orgVerified.message };
        }
      }

      // Both of these are idempotent — safe to (re)assert every time, and that
      // is the point: provisionOrg REUSES an existing org, so an org seeded
      // before either existed only gets it by being re-asserted here.
      await this.ensurePrimaryLocation(organizationId);

      const sub = await this.forceCreateSubscription(organizationId);
      if (!sub.success) {
        return { success: false, message: sub.message };
      }

      // Point the session at the org it was provisioned for.
      //
      // The session is minted BEFORE the org exists (sign-in cannot reference
      // an org that is not created yet), so without this every provisioned org
      // hands back a session with no `activeOrganizationId`. Seeds then fire
      // org-scoped calls straight after sign-in — before the frontend's
      // `_authed` guard has patched the session — and get "No active
      // organization selected".
      //
      // Calls Better Auth directly rather than the `organizations` feature
      // barrel: that barrel pulls in invite-member -> @borradh-workspace/email,
      // which reads env at module load and breaks this file's jest suite.
      try {
        const cookieName =
          process.env.NODE_ENV === 'production' || process.env.COOKIE_DOMAIN
            ? '__Secure-better-auth.session_token'
            : 'better-auth.session_token';
        const headers = new Headers();
        headers.set(
          'cookie',
          `${cookieName}=${encodeURIComponent(session.token)}`
        );
        await auth.api.setActiveOrganization({
          headers,
          body: { organizationId },
          asResponse: true,
        });
      } catch (error) {
        // Warn-only: the org and session are already usable, and a provisioning
        // helper should not fail the suite over the active-org pointer.
        this.logger.warn(
          `provisionOrg: could not set active org on the session: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      this.logger.log(
        `Provisioned E2E org ${organizationId} for ${input.email}`
      );

      return {
        success: true,
        message: 'Organization provisioned',
        data: {
          userId: session.user.id,
          organizationId,
          sessionToken: session.token,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`provisionOrg failed for ${input.email}: ${message}`);
      return { success: false, message };
    }
  }

  async createSession(
    email: string,
    password: string
  ): Promise<{
    success: boolean;
    token?: string;
    user?: { id: string; email: string; name: string | null };
    message: string;
  }> {
    try {
      const result = await signIn(auth.api, { email, password });

      if (!result.success) {
        return {
          success: false,
          message: `Sign-in failed: ${result.error.message}`,
        };
      }

      if (result.data.twoFactorRequired) {
        return {
          success: false,
          message:
            'Two-factor authentication required — not supported in E2E testing',
        };
      }

      this.logger.log(`Created session for E2E user: ${email}`);

      return {
        success: true,
        token: result.data.session.token,
        user: {
          id: result.data.user.id,
          email: result.data.user.email,
          name: result.data.user.name,
        },
        message: 'Session created successfully',
      };
    } catch (error) {
      logError('testing.createSession', error, { feature: 'testing' });
      return {
        success: false,
        message: `Failed to create session: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Health check for the testing endpoints.
   */
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get the latest email verification token for a given email address.
   * Checks Redis first (stored by sendVerificationEmail callback),
   * then falls back to the DB verification table.
   */
  /**
   * Issue a manage-booking link for an appointment.
   *
   * E2E needs the raw token, and the raw token is deliberately unrecoverable —
   * we persist only its SHA-256. So this MINTS a fresh capability rather than
   * reading one back, which is exactly what the confirmation email does. Same
   * exfiltration risk as `verification-token`, so it carries the same guard.
   */
  /**
   * TEST-ONLY. Mint a retrievable patient sign-in OTP for an eligible lead so
   * E2E can complete the passwordless flow without reading the hashed emailed
   * code. Returns a live credential — DestructiveTestingGuard on the route.
   */
  async issuePatientOtp(
    email: string,
    organizationSlug: string
  ): Promise<{ otp: string } | { message: string }> {
    // Lazy import: the patient-auth barrel pulls in the patient Better Auth
    // instance (→ email env validation) at load time. Deferring it keeps the
    // dozens of other testing.service jest specs — which never touch this path
    // — from tripping that validation at import.
    const { issuePatientTestOtp } = await import(
      '@borradh-workspace/features/patient-auth'
    );
    const result = await issuePatientTestOtp(db, { email, organizationSlug });
    if (!result) {
      return { message: 'No eligible patient for that email/organization' };
    }
    return result;
  }

  async issueManageBookingLink(appointmentId: string): Promise<{
    success: boolean;
    token?: string;
    url?: string;
    message: string;
  }> {
    const [appt] = await db
      .select({
        id: appointment.id,
        organizationId: appointment.organizationId,
        endDate: appointment.endDate,
      })
      .from(appointment)
      .where(eq(appointment.id, appointmentId));

    if (!appt) {
      return {
        success: false,
        message: `Appointment ${appointmentId} not found`,
      };
    }

    const [org] = await db
      .select({ slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, appt.organizationId));

    if (!org) {
      return { success: false, message: 'Organization not found' };
    }

    const issued = await issueManageToken(db, {
      organizationId: appt.organizationId,
      appointmentId: appt.id,
      appointmentEnd: appt.endDate,
    });

    if (!issued.success) {
      return { success: false, message: issued.error.message };
    }

    return {
      success: true,
      token: issued.data.token,
      url: buildManageBookingUrl(
        await resolveMicrositeLinkTarget(db, {
          id: appt.organizationId,
          slug: org.slug,
        }),
        issued.data.token
      ),
      message: 'Manage-booking link issued',
    };
  }

  async getVerificationToken(
    email: string
  ): Promise<{ success: boolean; token?: string; message: string }> {
    this.logger.log(`[E2E-DEBUG] getVerificationToken called for ${email}`);
    try {
      // Check Redis first (set by auth server's sendVerificationEmail callback)
      try {
        const redis = getRedis();
        this.logger.log('[E2E-DEBUG] getVerificationToken redis connected');
        const key = `e2e:verification-token:${email}`;
        const redisToken = await redis.get(key);
        this.logger.log(
          `[E2E-DEBUG] getVerificationToken redis GET ${key} → found=${!!redisToken}, len=${redisToken?.length ?? 0}`
        );
        if (redisToken) {
          return {
            success: true,
            token: redisToken,
            message: 'Verification token found in Redis',
          };
        }
      } catch (redisErr) {
        this.logger.error(
          `[E2E-DEBUG] getVerificationToken redis FAILED: ${redisErr instanceof Error ? redisErr.message : String(redisErr)}`
        );
      }

      // Fallback: check DB verification table
      // NOTE: Better Auth verification tokens are JWTs (not stored in DB),
      // so this fallback only works if the auth callback also wrote to the DB.
      this.logger.log(
        `[E2E-DEBUG] getVerificationToken falling back to DB for ${email}`
      );
      const results = await withSystemScope(
        (conn) =>
          conn
            .select()
            .from(verification)
            .where(eq(verification.identifier, email))
            .limit(1),
        { db }
      );

      this.logger.log(
        `[E2E-DEBUG] getVerificationToken DB results: ${results.length} rows`
      );

      if (results.length === 0) {
        return {
          success: false,
          message: `No verification token found for ${email}`,
        };
      }

      return {
        success: true,
        token: results[0].value,
        message: 'Verification token found',
      };
    } catch (error) {
      logError('testing.getVerificationToken', error, { feature: 'testing' });
      return {
        success: false,
        message: `Failed to get verification token: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Get the latest password reset token for a given email address.
   * Queries the verification table ordered by createdAt desc to get the most recent token,
   * which ensures we get the reset token (not an older email verification token).
   */
  async getResetPasswordToken(
    email: string
  ): Promise<{ success: boolean; token?: string; message: string }> {
    this.logger.log(`[E2E-DEBUG] getResetPasswordToken called for ${email}`);
    try {
      // Check Redis first (set by auth server's sendResetPassword callback)
      try {
        const redis = getRedis();
        this.logger.log('[E2E-DEBUG] getResetPasswordToken redis connected');
        const key = `e2e:reset-token:${email}`;
        const redisToken = await redis.get(key);
        this.logger.log(
          `[E2E-DEBUG] getResetPasswordToken redis GET ${key} → found=${!!redisToken}, len=${redisToken?.length ?? 0}`
        );
        if (redisToken) {
          return {
            success: true,
            token: redisToken,
            message: 'Reset password token found in Redis',
          };
        }
      } catch (redisErr) {
        this.logger.error(
          `[E2E-DEBUG] getResetPasswordToken redis FAILED: ${redisErr instanceof Error ? redisErr.message : String(redisErr)}`
        );
      }

      // Fallback: check DB verification table
      // NOTE: Better Auth stores reset tokens as identifier='reset-password:{token}', value=userId
      // so querying by email won't find them. This fallback only works if we add DB writes above.
      this.logger.log(
        `[E2E-DEBUG] getResetPasswordToken falling back to DB for ${email}`
      );
      const results = await withSystemScope(
        (conn) =>
          conn
            .select()
            .from(verification)
            .where(eq(verification.identifier, email))
            .orderBy(desc(verification.createdAt))
            .limit(1),
        { db }
      );

      this.logger.log(
        `[E2E-DEBUG] getResetPasswordToken DB results: ${results.length} rows`
      );

      if (results.length === 0) {
        return {
          success: false,
          message: `No reset token found for ${email}`,
        };
      }

      return {
        success: true,
        token: results[0].value,
        message: 'Reset password token found',
      };
    } catch (error) {
      logError('testing.getResetPasswordToken', error, { feature: 'testing' });
      return {
        success: false,
        message: `Failed to get reset password token: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Force-verify a user's email address by setting emailVerified = true.
   */
  async forceVerifyUser(
    email: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const result = await withSystemScope(
        (conn) =>
          conn
            .update(user)
            .set({ emailVerified: true })
            .where(eq(user.email, email))
            .returning({ id: user.id }),
        { db }
      );

      if (result.length === 0) {
        return { success: false, message: `User not found: ${email}` };
      }

      this.logger.log(`Force-verified user email: ${email}`);
      return { success: true, message: `Email verified for ${email}` };
    } catch (error) {
      logError('testing.forceVerifyUser', error, { feature: 'testing' });
      return {
        success: false,
        message: `Failed to force-verify user: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Force-verify an organization (placeholder for any org verification status).
   * Currently sets organization metadata to indicate verification.
   */
  async forceVerifyOrganization(
    organizationId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const result = await withSystemScope(
        (conn) =>
          conn
            .select({ id: organization.id })
            .from(organization)
            .where(eq(organization.id, organizationId))
            .limit(1),
        { db }
      );

      if (result.length === 0) {
        return {
          success: false,
          message: `Organization not found: ${organizationId}`,
        };
      }

      this.logger.log(`Force-verified organization: ${organizationId}`);
      return {
        success: true,
        message: `Organization verified: ${organizationId}`,
      };
    } catch (error) {
      logError('testing.forceVerifyOrganization', error, {
        feature: 'testing',
      });
      return {
        success: false,
        message: `Failed to force-verify organization: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Create a verified organization for an existing user and make that user its
   * owner — a pure-API org provisioner with no onboarding wizard and no UI.
   *
   * This is the deterministic alternative to driving the onboarding flow in a
   * browser (CONNECTED-ISOLATION.md, option 3a): it lets a connected/targeting
   * E2E test mint a fresh org per case so per-org state (chatbot targeting
   * flags, etc.) is private to that test and the suite can run parallel.
   *
   * Like `seedTestData`, it inserts the `organization` + owner `member` rows
   * directly via `withSystemScope` rather than going through
   * `createOrganization`, because that feature service has heavy side effects
   * (Stripe customer creation, Loops/Notion events, a default sequence) that
   * are undesirable noise in a test fixture. The org is "verified" in the same
   * sense as `forceVerifyOrganization` — a real org row the chatbot/feature
   * pipeline treats as live.
   *
   * Idempotency note: each call mints a fresh org (random id + unique slug),
   * so callers get a distinct org every time. Cleanup happens via
   * `cleanupByEmailPattern` reaping the owning user by the `e2e.test.%` email.
   */
  /**
   * Give a seeded org the primary branch a real org is required to have.
   *
   * Every seeded org needs one for the same reason it needs
   * `primaryCalendarType`: the onboarding wizard's locations step will not
   * advance without at least one branch, and a seeded org never runs the
   * wizard.
   *
   * Without it a seeded org is not merely missing data — it is unusable. Every
   * branch-scoped surface lives under `/dashboard/l/:branch/…`, so with no
   * branch to resolve there is no URL to navigate to: the location switcher
   * renders "No location set up yet" and the calendar, sales, catalog, clients,
   * marketing and team surfaces render nothing at all. Specs that drove those
   * paths were passing their URL assertions against an empty page.
   *
   * Idempotent, and asserted on every provision rather than only at create —
   * same treatment as the subscription upsert. `provisionOrg` REUSES an
   * existing org, so a create-time-only fix would leave every already-seeded
   * fixture (the shared bare and connected orgs, and every preview DB that has
   * run a suite before) permanently branchless. Re-asserting is what lets those
   * self-heal on the next setup run.
   *
   * The fixed slug is deliberate: `branchHandle()` prefers the slug over the
   * id, so seeded orgs produce a stable, readable `/dashboard/l/main/calendar`
   * rather than a per-run cuid. Slugs are unique PER ORG, so every seeded org
   * can use the same one.
   */
  private async ensurePrimaryLocation(
    organizationId: string,
    now: Date = new Date()
  ): Promise<void> {
    const existing = await withSystemScope(
      (conn) =>
        conn
          .select({
            id: organizationLocation.id,
            latitude: organizationLocation.latitude,
            longitude: organizationLocation.longitude,
          })
          .from(organizationLocation)
          .where(eq(organizationLocation.organizationId, organizationId))
          .limit(1),
      { db }
    );

    if (existing.length > 0) {
      // A branch already exists — but it may PREDATE coordinates being
      // required. The long-lived connected-org fixture is provisioned once and
      // reused across runs, so a plain early-return leaves it permanently
      // ungeocoded and every radius campaign refuses it with "we could not
      // place … on the map". Backfill rather than skip; a branch that already
      // has coordinates is untouched.
      const row = existing[0];
      if (row.latitude == null || row.longitude == null) {
        await withSystemScope(
          (conn) =>
            conn
              .update(organizationLocation)
              .set({ latitude: 53.3498, longitude: -6.2603, updatedAt: now })
              .where(eq(organizationLocation.id, row.id)),
          { db }
        );
        this.logger.log(
          `ensurePrimaryLocation: backfilled coordinates on existing branch ${row.id}`
        );
      }
      return;
    }

    await withSystemScope(
      (conn) =>
        conn
          .insert(organizationLocation)
          .values({
            id: this.generateId(),
            organizationId,
            name: 'Main',
            slug: 'main',
            addressLine1: '1 Test Street',
            city: 'Dublin',
            country: 'ie',
            // Real coordinates, not null. A campaign takes its radius centre
            // from the branch's geocode, and `resolveCampaignLocation` refuses
            // a branch it cannot place on a map — correctly, since guessing is
            // how ads once ran at Null Island. A provisioned org with an
            // ungeocoded branch is an unrealistic fixture: every org that goes
            // through the real location form is geocoded against Google.
            latitude: 53.3498,
            longitude: -6.2603,
            isPrimary: true,
            sortOrder: 0,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing(),
      { db }
    );
  }

  async createOrg(input: {
    userId: string;
    name: string;
    businessType?: string;
  }): Promise<{
    success: boolean;
    message: string;
    data?: { organizationId: string; userId: string };
  }> {
    // Validate first — Zod gives the endpoint a real VALIDATION_ERROR path
    // (bad businessType, empty name) before any DB write, mirroring how every
    // feature service guards its input.
    const parsed = createOrgSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
      };
    }
    const { userId, name, businessType } = parsed.data;

    try {
      // The owning user must already exist (created via /auth/sign-up +
      // force-verify). Fail clearly rather than insert an orphaned org.
      const existingUser = await withSystemScope(
        (conn) =>
          conn
            .select({ id: user.id })
            .from(user)
            .where(eq(user.id, userId))
            .limit(1),
        { db }
      );

      if (existingUser.length === 0) {
        return { success: false, message: `User not found: ${userId}` };
      }

      const organizationId = this.generateId();
      const memberId = this.generateId();
      const now = new Date();

      const [newOrg] = await withSystemScope(
        (conn) =>
          conn
            .insert(organization)
            .values({
              id: organizationId,
              name,
              // Unique slug so concurrent per-test orgs never collide on the
              // organization.slug unique constraint.
              slug: `e2e-test-org-${Date.now()}-${randomUUID().slice(0, 8)}`,
              businessType: businessType ?? 'salon',
              createdAt: now,
              // Seeded orgs book on OUR calendar. /dashboard/calendar renders a
              // "connect a calendar" empty state for anything that isn't
              // 'borradh', so leaving this unset gives every seeded org no
              // calendar at all — and specs that drive it (the nav journey, the
              // booking flows) would be testing the wrong surface. A real org
              // picks its calendar during onboarding; a seeded one never runs it.
              primaryCalendarType: 'borradh',
            })
            .returning({ id: organization.id }),
        { db }
      );

      await withSystemScope(
        (conn) =>
          conn
            .insert(member)
            .values({
              id: memberId,
              userId,
              organizationId: newOrg.id,
              role: 'owner',
              createdAt: now,
            })
            .onConflictDoNothing(),
        { db }
      );

      await this.ensurePrimaryLocation(newOrg.id, now);

      this.logger.log(`Created E2E org ${newOrg.id} owned by user ${userId}`);

      return {
        success: true,
        message: 'Organization created',
        data: { organizationId: newOrg.id, userId },
      };
    } catch (error) {
      logError('testing.createOrg', error, { feature: 'testing' });
      return {
        success: false,
        message: `Failed to create organization: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Get the active organization ID from a user's session.
   */
  async getActiveOrganizationId(sessionToken: string): Promise<{
    success: boolean;
    organizationId?: string;
    message: string;
  }> {
    try {
      // Use Better Auth's API to validate the session (handles Redis + token hashing)
      // Cookies are always secure (see auth server config), so prefix is __Secure-
      const headers = new Headers();
      headers.set(
        'cookie',
        `__Secure-better-auth.session_token=${sessionToken}`
      );

      const sessionResult = await auth.api.getSession({ headers });

      if (!sessionResult?.session) {
        return { success: false, message: 'Session not found' };
      }

      const activeOrganizationId = sessionResult.session.activeOrganizationId;
      const userId = sessionResult.session.userId;

      // Fallback: if activeOrganizationId is null, look up from memberships
      if (!activeOrganizationId && userId) {
        const memberships = await withSystemScope(
          (conn) =>
            conn
              .select({ organizationId: member.organizationId })
              .from(member)
              .where(eq(member.userId, userId))
              .limit(1),
          { db }
        );

        if (memberships.length > 0) {
          return {
            success: true,
            organizationId: memberships[0].organizationId,
            message: 'Organization found via membership fallback',
          };
        }
      }

      return {
        success: true,
        organizationId: activeOrganizationId ?? undefined,
        message: 'Active organization found',
      };
    } catch (error) {
      logError('testing.getActiveOrganizationId', error, {
        feature: 'testing',
      });
      return {
        success: false,
        message: `Failed to get active organization: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Force-create a subscription for an organization.
   * Creates a trialing subscription with a 30-day trial period.
   */
  async forceCreateSubscription(organizationId: string): Promise<{
    success: boolean;
    message: string;
    data?: { subscriptionId: string };
  }> {
    try {
      const now = new Date();
      const trialEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const subscriptionId = this.generateId();

      await withSystemScope(
        (conn) =>
          conn
            .insert(subscriptions)
            .values({
              id: subscriptionId,
              organizationId,
              // randomUUID, NOT Date.now(). `stripe_subscription_id` is UNIQUE,
              // and Date.now() has MILLISECOND resolution — two provisions in the
              // same millisecond (routine at 26 workers) minted the SAME id and
              // the insert died on the unique constraint. `onConflictDoUpdate`
              // targets organization_id, so it never absorbed that collision; it
              // surfaced as a raw `Failed query: insert into "subscriptions"` and
              // read like DB load. It was a colliding id.
              stripeCustomerId: `cus_e2e_test_${randomUUID()}`,
              stripeSubscriptionId: `sub_e2e_test_${randomUUID()}`,
              status: 'trialing',
              planId: 'pro',
              trialStart: now,
              trialEnd,
              currentPeriodStart: now,
              currentPeriodEnd: trialEnd,
            })
            // `organization_id` is UNIQUE, so this used to be
            // onConflictDoNothing() — which meant "force" did nothing at all
            // whenever a row already existed. A trial EXPIRES with the mere
            // passage of time, so the long-lived bare org eventually held a
            // lapsed `trialing` row that this endpoint refused to touch; the org
            // was then unsubscribed forever and billing.spec.ts ("/billing
            // redirects the SUBSCRIBED bare user") failed for a reason that had
            // nothing to do with the redirect under test.
            //
            // Force means force: refresh the window and the status in place.
            .onConflictDoUpdate({
              target: subscriptions.organizationId,
              set: {
                status: 'trialing',
                planId: 'pro',
                trialStart: now,
                trialEnd,
                currentPeriodStart: now,
                currentPeriodEnd: trialEnd,
              },
            }),
        { db }
      );

      this.logger.log(`Force-created subscription for org: ${organizationId}`);

      return {
        success: true,
        message: `Subscription created for organization: ${organizationId}`,
        data: { subscriptionId },
      };
    } catch (error) {
      logError('testing.forceCreateSubscription', error, {
        feature: 'testing',
      });
      return {
        success: false,
        message: `Failed to create subscription: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Seeds test data for E2E tests.
   * Creates:
   * - A test user (using E2E_TEST_EMAIL env var)
   * - A test organization
   * - Membership linking the user to the organization
   */
  async seedTestData(): Promise<{
    success: boolean;
    message: string;
    data?: {
      userId: string;
      organizationId: string;
    };
  }> {
    const testEmail = apiEnv.E2E_TEST_EMAIL;

    if (!testEmail) {
      return {
        success: false,
        message: 'E2E_TEST_EMAIL environment variable not set',
      };
    }

    try {
      this.logger.log('Starting E2E test data seeding...');

      // Create test user
      const userId = this.generateId();
      const testUser = await withSystemScope(
        (conn) =>
          conn
            .insert(user)
            .values({
              id: userId,
              name: 'E2E Test User',
              email: testEmail,
              emailVerified: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .onConflictDoNothing()
            .returning(),
        { db }
      );

      // If user already exists (conflict), find them
      let actualUserId = userId;
      if (testUser.length === 0) {
        this.logger.log('Test user already exists, finding existing user...');
        const existingUsers = await withSystemScope(
          (conn) =>
            conn
              .select()
              .from(user)
              .where(like(user.email, testEmail))
              .limit(1),
          { db }
        );

        if (existingUsers.length > 0) {
          actualUserId = existingUsers[0].id;
        }
      }

      // Create test organization
      const organizationId = this.generateId();
      const testOrg = await withSystemScope(
        (conn) =>
          conn
            .insert(organization)
            .values({
              id: organizationId,
              name: 'E2E Test Organization',
              slug: `e2e-test-org-${Date.now()}`,
              businessType: 'salon',
              tagline: 'E2E Testing Salon',
              createdAt: new Date(),
            })
            .returning(),
        { db }
      );

      // Create membership
      const memberId = this.generateId();
      await withSystemScope(
        (conn) =>
          conn
            .insert(member)
            .values({
              id: memberId,
              userId: actualUserId,
              organizationId: testOrg[0].id,
              role: 'owner',
              createdAt: new Date(),
            })
            .onConflictDoNothing(),
        { db }
      );

      // Create subscription so user can access protected routes
      await this.forceCreateSubscription(testOrg[0].id);

      this.logger.log(
        `E2E test data seeded successfully: user=${actualUserId}, org=${testOrg[0].id}`
      );

      return {
        success: true,
        message: 'Test data seeded successfully',
        data: {
          userId: actualUserId,
          organizationId: testOrg[0].id,
        },
      };
    } catch (error) {
      logError('testing.seedData', error, { feature: 'testing' });
      return {
        success: false,
        message: `Failed to seed test data: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Seed an appointment for E2E tests.
   * Creates an appointment via the createAppointment feature service.
   */
  async seedAppointment(input: {
    sessionToken: string;
    title: string;
    startDate: string;
    endDate: string;
    color?: string;
    status?: string;
    leadId: string;
    assignedToId: string;
  }): Promise<{
    success: boolean;
    message: string;
    data?: { appointmentId: string };
  }> {
    try {
      // Get org from session
      const orgResult = await this.getActiveOrganizationId(input.sessionToken);
      if (!orgResult.success || !orgResult.organizationId) {
        return {
          success: false,
          message: 'Could not determine organization from session',
        };
      }

      // Seed via the system scope (BYPASSRLS): this is test setup, not the
      // org-scoped request path, and createAppointment internally uses
      // withOrgScope — which under RLS needs an ambient scope. withSystemScope
      // provides it (see rls-context: nested withOrgScope runs as app_system).
      // Hoist the (guard-narrowed) org id to a const — TS drops the narrowing
      // inside the closure below.
      const organizationId = orgResult.organizationId;
      const result = await withSystemScope(
        (conn) =>
          createAppointment(conn, {
            organizationId,
            title: input.title,
            startDate: input.startDate,
            endDate: input.endDate,
            leadId: input.leadId,
            assignedToId: input.assignedToId,
            color:
              (input.color as
                | 'blue'
                | 'green'
                | 'red'
                | 'yellow'
                | 'purple'
                | 'orange') || 'blue',
            status:
              (input.status as
                | 'booked'
                | 'confirmed'
                | 'arrived'
                | 'started'
                | 'completed'
                | 'cancelled'
                | 'no_show') || 'booked',
          }),
        { db }
      );

      if (!result.success) {
        return {
          success: false,
          message: `Failed to create appointment: ${result.error.message}`,
        };
      }

      this.logger.log(`Seeded appointment: ${result.data.id}`);
      return {
        success: true,
        message: 'Appointment created',
        data: { appointmentId: result.data.id },
      };
    } catch (error) {
      logError('testing.seedAppointment', error, { feature: 'testing' });
      return {
        success: false,
        message: `Failed to seed appointment: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Seed a video asset for E2E tests.
   * Inserts directly into the asset table with a per-organization deterministic
   * ID — idempotent within an org, and never bound to a stale org. A fixed
   * cross-org ID + onConflictDoNothing silently no-ops for every org after the
   * first, leaving later orgs (e.g. a recreated connected org) with no seeded
   * media and every ad test skipping on "no ready media".
   *
   * `source` defaults to 'edited' (skips AI analysis — usable by the render
   * pipeline without the probe/transcode worker). Pass 'raw' to seed an asset
   * the uploaded-footage picker can see: it lists `source: 'raw'` only (see
   * buildUploadedVideoLibrary), so an 'edited' seed never populates it.
   */
  /**
   * Copy a durable public E2E fixture to a throwaway key, and hand back the URL.
   *
   * ── THE BUG THIS EXISTS TO CLOSE ────────────────────────────────────────
   * `deleteAsset` hard-deletes the S3 object behind an asset's `blobUrl`
   * (assets/services/delete-asset — "fire-and-forget S3 cleanup on hard-delete").
   * That is correct: an owner deleting their upload should not leave the file
   * behind.
   *
   * But several specs seeded an asset whose `blobUrl` pointed AT THE SHARED
   * FIXTURE, then deleted that asset in teardown. So the teardown deleted the
   * fixture — for that run, and for every run afterwards. That is the whole
   * mechanism behind an outage that had been "fixed" twice by re-uploading:
   *
   *   - `test-video.mp4` disappeared → every ad-launch spec failed at publish
   *     with "Failed to download video from S3: HTTP 404".
   *   - `test-image.jpg` disappeared → three real-render specs failed with
   *     "E2E image fixture must be reachable", nightly after nightly.
   *
   * Restoring the object at the start of a run (the `provision-e2e-media` CI
   * job) is necessary but not sufficient: the run then deletes it again, so
   * anything consuming it LATER in the same run still fails. The fix is for a
   * spec's asset to own its own object. Clone first, seed the clone, and let
   * teardown delete the copy it was always entitled to delete.
   *
   * Constrained: source must be an object under `e2e/` in this stack's public
   * bucket, destination is always a fresh key under `e2e/ephemeral/`.
   */
  async cloneFixture(input: { sourceUrl: string }): Promise<{
    success: boolean;
    message: string;
    data?: { url: string };
  }> {
    const parsed = cloneFixtureSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: `Invalid clone request: ${parsed.error.issues
          .map((i) => i.message)
          .join('; ')}`,
      };
    }

    const bucket = getPublicAssetsBucket();
    const region = getS3Region();
    const base = `https://${bucket}.s3.${region}.amazonaws.com/`;

    if (!parsed.data.sourceUrl.startsWith(`${base}${E2E_FIXTURE_PREFIX}`)) {
      return {
        success: false,
        message: `sourceUrl must be an object under ${base}${E2E_FIXTURE_PREFIX}`,
      };
    }

    const sourceKey = parsed.data.sourceUrl.slice(base.length);
    // A clone of a clone would defeat the point — and would let a caller walk
    // the ephemeral space.
    if (
      sourceKey.startsWith(
        E2E_EPHEMERAL_PREFIX.slice(E2E_FIXTURE_PREFIX.length)
      )
    ) {
      return {
        success: false,
        message: 'sourceUrl must be a durable fixture, not an ephemeral clone',
      };
    }

    const filename = sourceKey.split('/').pop() ?? 'fixture';
    const key = `${E2E_EPHEMERAL_PREFIX}${randomUUID()}-${filename}`;

    try {
      await copyFromUrl({
        sourceUrl: parsed.data.sourceUrl,
        bucket,
        key,
      });
      const url = `${base}${key}`;
      this.logger.log(`Cloned E2E fixture ${sourceKey} -> ${key}`);
      return { success: true, message: 'Fixture cloned', data: { url } };
    } catch (error) {
      logError('testing.cloneFixture', error, {
        feature: 'testing',
        extra: { bucket, sourceKey, key },
      });
      return {
        success: false,
        message: `Failed to clone fixture: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  async seedAsset(input: {
    organizationId: string;
    uploadedById: string;
    name: string;
    blobUrl: string;
    source?: AssetSource;
  }): Promise<{
    success: boolean;
    message: string;
    data?: { assetId: string };
  }> {
    const source: AssetSource = input.source ?? 'edited';
    // Only non-default sources are namespaced, so the 'edited' ID every
    // existing caller already seeded stays byte-identical (no orphaned rows,
    // idempotency survives the upgrade) while a 'raw' seed coexists with it
    // instead of colliding on onConflictDoNothing.
    const assetId =
      source === 'edited'
        ? `e2e-seed-uploaded-video-${input.organizationId}`
        : `e2e-seed-uploaded-video-${source}-${input.organizationId}`;
    try {
      const result = await withSystemScope(
        (conn) =>
          conn
            .insert(asset)
            .values({
              id: assetId,
              name: input.name,
              blobUrl: input.blobUrl,
              type: 'video',
              source,
              organizationId: input.organizationId,
              uploadedById: input.uploadedById,
            })
            // Converge, don't freeze — same reasoning as seedVideo: the id is
            // deterministic, so onConflictDoNothing pinned the row to whatever
            // blobUrl the FIRST run happened to seed. When the fixture's asset
            // was repointed at a video that still exists in the bucket, every
            // org seeded before that kept handing Meta the deleted one.
            .onConflictDoUpdate({
              target: asset.id,
              set: {
                name: input.name,
                blobUrl: input.blobUrl,
                updatedAt: new Date(),
              },
            })
            .returning({ id: asset.id }),
        { db }
      );

      if (result.length === 0) {
        this.logger.log('Seed asset already exists, skipping');
        return {
          success: true,
          message: 'Asset already exists',
          data: { assetId },
        };
      }

      this.logger.log(`Seeded asset: ${assetId}`);
      return {
        success: true,
        message: 'Asset created',
        data: { assetId },
      };
    } catch (error) {
      logError('testing.seedAsset', error, { feature: 'testing' });
      return {
        success: false,
        message: `Failed to seed asset: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Seed a ready video for E2E tests.
   * Inserts directly into the video table with status='ready' and a
   * per-organization deterministic ID — idempotent within an org, and never
   * bound to a stale org. A fixed cross-org ID + onConflictDoNothing silently
   * no-ops for every org after the first, leaving later orgs (e.g. a recreated
   * connected org) with no seeded media and every ad test skipping on
   * "no ready media".
   */
  async seedVideo(input: {
    organizationId: string;
    createdById: string;
    title: string;
    blobUrl: string;
  }): Promise<{
    success: boolean;
    message: string;
    data?: { videoId: string };
  }> {
    const videoId = `e2e-seed-created-video-${input.organizationId}`;
    try {
      const result = await withSystemScope(
        (conn) =>
          conn
            .insert(video)
            .values({
              id: videoId,
              title: input.title,
              status: 'ready',
              blobUrl: input.blobUrl,
              organizationId: input.organizationId,
              createdById: input.createdById,
              draftConfig: {
                bRollClips: [],
                captions: {
                  enabled: false,
                  position: 'bottom',
                  fontFamily: 'Inter',
                  fontSize: 24,
                  textColor: '#ffffff',
                  highlightColor: '#ffcc00',
                  backgroundColor: '#000000',
                  showBackground: false,
                },
                musicVolume: 0,
                outro: {
                  businessName: 'E2E Test',
                  ctaText: 'Book Now',
                  backgroundOpacity: 0.8,
                  backgroundColor: '#000000',
                  textColor: '#ffffff',
                  durationSec: 3,
                },
                orientation: 'portrait',
              },
            })
            // Refresh the row rather than leaving a stale one in place. The id is
            // deterministic (idempotent seeding), so onConflictDoNothing meant an
            // asset seeded by an EARLIER run kept its OLD blobUrl forever — the
            // connected org went on handing Meta `e2e/test-video.mp4` (deleted
            // from the bucket, HTTP 404) long after the fixture was pointed at a
            // video that exists. "Idempotent" must mean converged, not frozen.
            .onConflictDoUpdate({
              target: video.id,
              set: {
                title: input.title,
                status: 'ready',
                blobUrl: input.blobUrl,
                updatedAt: new Date(),
                // Refresh createdAt too, so the seeded video is always the
                // NEWEST row. `listVideos` orders by `desc(createdAt)` and
                // defaults to limit 50, and the id here is deterministic — so
                // without this the row keeps the createdAt of the very first
                // seed and sinks a place further down the list every time the
                // org gains a video. Specs that pick it out of the wizard's
                // media list would start failing once the connected org passed
                // 50 videos, as an "it used to work" flake with no code change
                // behind it.
                createdAt: new Date(),
              },
            })
            .returning({ id: video.id }),
        { db }
      );

      if (result.length === 0) {
        this.logger.log('Seed video already exists, skipping');
        return {
          success: true,
          message: 'Video already exists',
          data: { videoId },
        };
      }

      this.logger.log(`Seeded video: ${videoId}`);
      return {
        success: true,
        message: 'Video created',
        data: { videoId },
      };
    } catch (error) {
      logError('testing.seedVideo', error, { feature: 'testing' });
      return {
        success: false,
        message: `Failed to seed video: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Seed a configured Meta Ads (Facebook) connection for E2E / preview tests.
   *
   * Writes meta_ads_integration + meta_ads_page rows directly from a provided
   * access token — bypassing the live Meta OAuth/popup so a connection can be
   * established in a fresh DB without a browser. Intended to be run once per
   * base Neon branch (main / preview-shared) with a non-expiring system-user
   * token so the connected test org has Facebook connected across all preview
   * branches.
   *
   * Idempotent: upserts on the unique (organizationId) and
   * (integrationId, pageId) constraints, refreshing the encrypted token on
   * re-seed. `tokenExpiresAt` is null because the seed token is expected to be
   * a never-expiring FLFB system-user token.
   *
   * NOT wired into setup-connected.ts yet — calling it is the activation step,
   * deferred until the FLFB config + a real system-user token exist.
   */
  async seedMetaAds(input: {
    organizationId: string;
    connectedById: string;
    accessToken: string;
    pageId: string;
    pageName?: string;
    adAccountId?: string;
    adAccountName?: string;
  }): Promise<{
    success: boolean;
    message: string;
    data?: { integrationId: string; pageRecordId: string };
  }> {
    try {
      const encryptedCredentials = encryptCredentials({
        accessToken: input.accessToken,
      });

      // Ask Meta what this page actually IS, rather than seeding a page that is
      // nameless and Instagram-less.
      //
      // - `name`: without it `meta_ads_page.page_name` stayed null, and the post
      //   composer's trigger fell back to "1 page selected" instead of naming the
      //   page the user just picked.
      // - `instagram_business_account`: the campaign form enables the
      //   `instagram_dm` destination only when the default page carries a
      //   `linkedInstagramAccountId` (use-create-campaign-form.ts:
      //   `hasInstagramLinked`). Nothing ever set it, so that destination was
      //   permanently disabled on the connected org and
      //   create-campaign.connected.spec.ts could not pass at all.
      //
      // Derived from the real page with the token we already hold — no new
      // secret, and it cannot drift from what Meta reports. Best-effort: a Graph
      // hiccup must not break the seed, it just leaves the fields null.
      let resolvedPageName = input.pageName ?? null;
      let linkedInstagramAccountId: string | null = null;
      let resolvedInstagramName: string | null = null;
      try {
        const params = new URLSearchParams({
          fields: 'name,instagram_business_account{id,username,name}',
          access_token: input.accessToken,
        });
        // Through the shared HTTP seam, not bare `fetch`: under META_E2E_STUB
        // the contract fake must serve this lookup. It resolves
        // `instagram_business_account`, and a null there permanently disables
        // the Instagram destination — create-campaign.connected.spec.ts cannot
        // pass without it (see the comment block above).
        const res = await fetchWithTimeout(
          `${GRAPH_API_BASE}/${input.pageId}?${params.toString()}`
        );
        if (res.ok) {
          const meta = (await res.json()) as {
            name?: string;
            instagram_business_account?: {
              id?: string;
              username?: string;
              name?: string;
            };
          };
          resolvedPageName = resolvedPageName ?? meta.name ?? null;
          linkedInstagramAccountId =
            meta.instagram_business_account?.id ?? null;
          // `username,name` were already being REQUESTED in the fields param
          // and then thrown away; the Instagram page row below needs a label.
          resolvedInstagramName =
            meta.instagram_business_account?.username ??
            meta.instagram_business_account?.name ??
            null;
        } else {
          this.logger.warn(
            `seed-meta-ads: Graph lookup for page ${input.pageId} returned ${res.status}`
          );
        }
      } catch (error) {
        this.logger.warn(
          `seed-meta-ads: Graph lookup for page ${input.pageId} failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      const [integration] = await withSystemScope(
        (conn) =>
          conn
            .insert(metaAdsIntegration)
            .values({
              organizationId: input.organizationId,
              connectedById: input.connectedById,
              configurationStatus: 'configured',
              adAccountId: input.adAccountId ?? null,
              adAccountName: input.adAccountName ?? null,
              encryptedCredentials,
              tokenStatus: 'valid',
              tokenExpiresAt: null,
              // The seed token is a never-expiring system-user token, i.e. an
              // FLfB connection. Say so explicitly instead of leaning on
              // isFlfbIntegration's null-connectionMethod + null-expiry
              // heuristic, so the connected org's card layout (combined
              // "Facebook & Instagram" vs legacy separate cards) is a stated
              // fact rather than a side effect of what the row happened to hold.
              connectionMethod: 'flfb',
              isActive: true,
            })
            .onConflictDoUpdate({
              target: metaAdsIntegration.organizationId,
              set: {
                connectedById: input.connectedById,
                configurationStatus: 'configured',
                adAccountId: input.adAccountId ?? null,
                adAccountName: input.adAccountName ?? null,
                encryptedCredentials,
                tokenStatus: 'valid',
                tokenExpiresAt: null,
                connectionMethod: 'flfb',
                isActive: true,
                updatedAt: new Date(),
              },
            })
            .returning(),
        { db }
      );

      const [page] = await withSystemScope(
        (conn) =>
          conn
            .insert(metaAdsPage)
            .values({
              metaAdsIntegrationId: integration.id,
              pageId: input.pageId,
              pageName: resolvedPageName,
              linkedInstagramAccountId,
              pageAccessToken: encryptedCredentials,
              platform: 'facebook',
              defaultAdAccountId: input.adAccountId ?? null,
              defaultAdAccountName: input.adAccountName ?? null,
              isActive: true,
            })
            .onConflictDoUpdate({
              target: [metaAdsPage.metaAdsIntegrationId, metaAdsPage.pageId],
              set: {
                pageName: resolvedPageName,
                linkedInstagramAccountId,
                pageAccessToken: encryptedCredentials,
                platform: 'facebook',
                defaultAdAccountId: input.adAccountId ?? null,
                defaultAdAccountName: input.adAccountName ?? null,
                isActive: true,
                updatedAt: new Date(),
              },
            })
            .returning(),
        { db }
      );

      // The Instagram page row.
      //
      // `linkedInstagramAccountId` on the FACEBOOK row is what enables the
      // `instagram_dm` campaign destination, but it is NOT what
      // `GET /integrations/meta-ads/pages` returns as an Instagram page — that
      // needs its own `meta_ads_page` with `platform: 'instagram'`. Without it
      // every Instagram spec fails with "Connected org has no active instagram
      // page", and the specs deliberately THROW rather than skip.
      //
      // Previously this only worked where the org had been connected through
      // the real OAuth flow at some point and the row persisted — i.e. on a
      // long-lived database. An org provisioned into a fresh database could
      // never have it, so Instagram coverage silently depended on inherited
      // state rather than on seeding.
      if (linkedInstagramAccountId) {
        await withSystemScope(
          (conn) =>
            conn
              .insert(metaAdsPage)
              .values({
                metaAdsIntegrationId: integration.id,
                pageId: linkedInstagramAccountId,
                pageName: resolvedInstagramName,
                linkedInstagramAccountId,
                pageAccessToken: encryptedCredentials,
                platform: 'instagram',
                defaultAdAccountId: input.adAccountId ?? null,
                defaultAdAccountName: input.adAccountName ?? null,
                isActive: true,
              })
              .onConflictDoUpdate({
                target: [metaAdsPage.metaAdsIntegrationId, metaAdsPage.pageId],
                set: {
                  pageName: resolvedInstagramName,
                  linkedInstagramAccountId,
                  pageAccessToken: encryptedCredentials,
                  platform: 'instagram',
                  isActive: true,
                  updatedAt: new Date(),
                },
              }),
          { db }
        );
        this.logger.log(
          `Seeded Instagram page ${linkedInstagramAccountId} for integration ${integration.id}`
        );
      } else {
        this.logger.warn(
          'seed-meta-ads: no instagram_business_account on the page — Instagram specs will fail'
        );
      }

      // Point the integration's default page at the seeded page when unset.
      if (!integration.defaultPageId) {
        await withSystemScope(
          (conn) =>
            conn
              .update(metaAdsIntegration)
              .set({ defaultPageId: page.id })
              .where(eq(metaAdsIntegration.id, integration.id)),
          { db }
        );
      }

      this.logger.log(
        `Seeded Meta Ads integration ${integration.id} (page ${page.id})`
      );
      return {
        success: true,
        message: 'Meta Ads connection seeded',
        data: { integrationId: integration.id, pageRecordId: page.id },
      };
    } catch (error) {
      logError('testing.seedMetaAds', error, { feature: 'testing' });
      return {
        success: false,
        message: `Failed to seed Meta Ads: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Seed a valid WhatsApp Business connection for E2E / preview tests.
   *
   * Writes a single whatsapp_account row directly from a provided (ideally
   * never-expiring system-user) token, bypassing the live Embedded Signup
   * flow that the connected test org can no longer complete. Idempotent on the
   * (organizationId, phoneNumberId) unique constraint, refreshing the encrypted
   * token on re-seed.
   *
   * The credential shape matches finalize-whatsapp-connection
   * ({ accessToken, tokenType, expiresIn }) so the reconnect-banner and
   * template-list code paths read it the same way as a real connection.
   *
   * `tokenExpiresAt` is null because the seed token is expected to be a
   * never-expiring system-user token (expiresIn = 0 → "does not expire").
   */
  async seedWhatsAppAccount(input: {
    organizationId: string;
    connectedById: string;
    accessToken: string;
    phoneNumberId: string;
    wabaId: string;
    phoneNumber: string;
    displayName?: string;
  }): Promise<{
    success: boolean;
    message: string;
    data?: { accountId: string; phoneNumberId: string };
  }> {
    try {
      const encryptedCredentials = encryptCredentials({
        accessToken: input.accessToken,
        tokenType: 'bearer',
        expiresIn: 0,
      });

      const [account] = await withSystemScope(
        (conn) =>
          conn
            .insert(whatsappAccount)
            .values({
              organizationId: input.organizationId,
              connectedById: input.connectedById,
              phoneNumberId: input.phoneNumberId,
              wabaId: input.wabaId,
              phoneNumber: input.phoneNumber,
              displayName: input.displayName ?? null,
              encryptedCredentials,
              tokenStatus: 'valid',
              tokenExpiresAt: null,
              isActive: true,
              isVerified: true,
              // Enable the chatbot on the seeded channel — without this the
              // account defaults to isChatbotActive=false, so WhatsApp inbound
              // messages create agent_handling conversations and the bot never
              // replies (resolveWhatsAppChatbot → effectiveChatbotActive=false).
              isChatbotActive: true,
            })
            .onConflictDoUpdate({
              target: [
                whatsappAccount.organizationId,
                whatsappAccount.phoneNumberId,
              ],
              set: {
                connectedById: input.connectedById,
                wabaId: input.wabaId,
                phoneNumber: input.phoneNumber,
                displayName: input.displayName ?? null,
                encryptedCredentials,
                tokenStatus: 'valid',
                tokenExpiresAt: null,
                isActive: true,
                isVerified: true,
                isChatbotActive: true,
                updatedAt: new Date(),
              },
            })
            .returning(),
        { db }
      );

      this.logger.log(
        `Seeded WhatsApp account ${account.id} (phone ${account.phoneNumberId})`
      );
      return {
        success: true,
        message: 'WhatsApp connection seeded',
        data: { accountId: account.id, phoneNumberId: account.phoneNumberId },
      };
    } catch (error) {
      logError('testing.seedWhatsAppAccount', error, { feature: 'testing' });
      return {
        success: false,
        message: `Failed to seed WhatsApp account: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Cleans up all E2E test data by email pattern.
   *
   * Strategy: find users matching the email pattern, find their organizations
   * via memberships, delete organizations (cascades most feature data),
   * then delete auth data and users.
   *
   * @param emailPattern - SQL LIKE pattern, defaults to 'e2e.test.%'
   */
  /**
   * @param olderThanMinutes When set, only data created BEFORE this many
   * minutes ago is deleted. Whole-namespace sweeps (the suite's global
   * teardown) MUST pass it — see below. A spec reaping the users it just made
   * itself passes nothing.
   */
  async cleanupByEmailPattern(
    emailPattern = 'e2e.test.%',
    olderThanMinutes?: number
  ): Promise<{
    success: boolean;
    message: string;
    deleted?: {
      organizations: number;
      users: number;
      verifications: number;
    };
  }> {
    try {
      this.logger.log(
        `Starting E2E cleanup for email pattern: ${emailPattern}${
          olderThanMinutes
            ? ` (older than ${olderThanMinutes} minutes)`
            : ' (no age guard)'
        }`
      );

      // The suites (bare / tabs / connected / smoke / quarantine) are separate
      // GitHub jobs running IN PARALLEL against the SAME preview API and DB, and
      // every one of them ends by sweeping the whole `e2e.test.%` namespace. So
      // the first suite to finish deleted the users and organizations the still-
      // running suites were in the middle of using: their next sign-in answered
      // "Invalid email or password" (the user was gone), their next insert died
      // on a foreign key (the org was gone), and sixteen unrelated specs failed
      // in the SAME SECOND — a signature that reads like a flaky app and is
      // really one job shooting the others.
      //
      // An age guard fixes the whole class rather than this instance: never
      // delete data young enough that a concurrent actor might still hold it. A
      // running suite's orgs are seconds to minutes old; junk from earlier runs
      // is hours old and still gets reaped. This does not depend on every future
      // spec remembering to namespace its emails correctly, which is the failure
      // mode a per-job prefix would have re-introduced the first time someone
      // forgot.
      const createdBefore =
        olderThanMinutes && olderThanMinutes > 0
          ? new Date(Date.now() - olderThanMinutes * 60_000)
          : null;

      // 1. Find all users matching the email pattern
      const matchingUsers = await withSystemScope(
        (conn) =>
          conn
            .select({ id: user.id })
            .from(user)
            .where(
              createdBefore
                ? and(
                    like(user.email, emailPattern),
                    lt(user.createdAt, createdBefore)
                  )
                : like(user.email, emailPattern)
            ),
        { db }
      );

      if (matchingUsers.length === 0) {
        this.logger.log('No users found matching pattern, nothing to clean up');
        return {
          success: true,
          message: 'No matching data to clean up',
          deleted: { organizations: 0, users: 0, verifications: 0 },
        };
      }

      const userIds = matchingUsers.map((u) => u.id);

      // 2. Find the organizations these users OWN.
      //
      // ⚠️  Deliberately `role = 'owner'`, NOT "every org they are a member of".
      //
      // Cleanup's contract is "delete the data these throwaway users CREATED",
      // not "delete every org they ever touched". A test user can legitimately
      // be a NON-OWNER member of a long-lived shared org — e.g. the invited
      // non-owner in journeys/practitioner-booking.spec.ts, who accepts an
      // invitation into the shared BARE org to prove `POST /practitioners` is
      // owner-only. Selecting by membership swept that shared org into the
      // DELETE below and cascaded it out of existence: the bare OWNER survived
      // (their email doesn't match the pattern) but their organization did not,
      // so every later run signed in fine, saw zero orgs, and got routed to the
      // new-user /welcome deck — a suite that destroys its own fixture, then
      // fails in a way that looks nothing like the cause.
      //
      // Non-owner memberships need no explicit cleanup: `member.user_id` is
      // ON DELETE CASCADE, so deleting the user in step 5 removes the row and
      // leaves the shared org intact.
      const ownedOrgs = await withSystemScope(
        (conn) =>
          conn
            .select({ organizationId: member.organizationId })
            .from(member)
            .where(
              and(inArray(member.userId, userIds), eq(member.role, 'owner'))
            ),
        { db }
      );

      const orgIds = [...new Set(ownedOrgs.map((m) => m.organizationId))];

      // 3. Delete organizations (cascades: leads, appointments, sequences,
      //    social posts, meta ads, chatbots, videos, assets, services,
      //    locations, practitioners, billing, integrations, members, invitations)
      let deletedOrgs = 0;
      if (orgIds.length > 0) {
        const result = await withSystemScope(
          (conn) =>
            conn
              .delete(organization)
              .where(inArray(organization.id, orgIds))
              .returning({ id: organization.id }),
          { db }
        );
        deletedOrgs = result.length;
      }

      // 4. Delete auth data (sessions, accounts cascade via user delete,
      //    but verifications are standalone)
      // Age-guarded for the same reason as the users above: a verification row
      // is the token a CONCURRENT suite is about to redeem to verify an email.
      const deletedVerifications = await withSystemScope(
        (conn) =>
          conn
            .delete(verification)
            .where(
              createdBefore
                ? and(
                    like(verification.identifier, emailPattern),
                    lt(verification.createdAt, createdBefore)
                  )
                : like(verification.identifier, emailPattern)
            )
            .returning({ id: verification.id }),
        { db }
      );

      // 5. Delete users (cascades: sessions, accounts, apikeys, device tokens)
      const deletedUsers = await withSystemScope(
        (conn) =>
          conn
            .delete(user)
            .where(inArray(user.id, userIds))
            .returning({ id: user.id }),
        { db }
      );

      this.logger.log(
        `E2E cleanup complete: ${deletedOrgs} orgs, ${deletedUsers.length} users, ${deletedVerifications.length} verifications`
      );

      return {
        success: true,
        message: 'Cleanup completed successfully',
        deleted: {
          organizations: deletedOrgs,
          users: deletedUsers.length,
          verifications: deletedVerifications.length,
        },
      };
    } catch (error) {
      logError('testing.cleanupByEmailPattern', error, {
        feature: 'testing',
      });
      return {
        success: false,
        message: `Failed to cleanup: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Simulate a webhook by calling handleIncomingMessage directly.
   * Used for chatbot E2E testing since Meta has no API for sending messages AS a user.
   *
   * For WhatsApp, `pageId` should be the org's `whatsapp_account.phone_number_id`
   * and `senderId` should be the customer's phone number (e.g. `+15551234567`).
   */
  /**
   * Run one step of Claire's outbound-first sequence directly.
   *
   * Calls the same services the `lead-first-touch` worker calls, so everything
   * except the trigger is the production path.
   */
  async simulateLeadFirstTouch(input: {
    organizationId: string;
    leadId: string;
    step?: 'opener' | 'followup_1' | 'followup_2';
    conversationId?: string;
  }) {
    const step = input.step ?? 'opener';

    if (step === 'opener') {
      const result = await sendLeadFirstTouch(db, {
        organizationId: input.organizationId,
        leadId: input.leadId,
      });
      return result.success
        ? { ok: true, ...result.data }
        : { ok: false, error: result.error.message };
    }

    if (!input.conversationId) {
      return { ok: false, error: 'conversationId is required for a follow-up' };
    }

    const result = await sendLeadFollowUp(db, {
      organizationId: input.organizationId,
      leadId: input.leadId,
      conversationId: input.conversationId,
      step,
    });
    return result.success
      ? { ok: true, ...result.data }
      : { ok: false, error: result.error.message };
  }

  async simulateWebhook(input: {
    platform: 'facebook_messenger' | 'instagram_dm' | 'whatsapp';
    pageId: string;
    senderId: string;
    messageText: string;
    queueDelayMs?: number;
    adReferral?: { metaAdId: string; source?: string; adTitle?: string };
  }): Promise<{
    success: boolean;
    conversationId?: string;
    messageId?: string;
    message: string;
  }> {
    try {
      const result = await withSystemScope(
        (conn) =>
          handleIncomingMessage(conn, {
            pageId: input.pageId,
            senderId: input.senderId,
            messageText: input.messageText,
            messageId: `mid.test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            platform: input.platform,
            timestamp: Date.now(),
            queueDelayMs: input.queueDelayMs ?? 0,
            skipExternalDelivery: true,
            adReferral: input.adReferral,
          }),
        { db }
      );

      if (!result.success) {
        return {
          success: false,
          message: `handleIncomingMessage failed: ${result.error.message}`,
        };
      }

      return {
        success: true,
        conversationId: result.data.conversationId,
        messageId: result.data.messageId,
        message: 'Webhook simulated successfully',
      };
    } catch (error) {
      logError('testing.simulateWebhook', error, { feature: 'testing' });
      return {
        success: false,
        message: `Failed to simulate webhook: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Inject a Stripe Connect webhook event WITHOUT signature verification, for
   * E2E. Reproduces the real router (StripeConnectWebhooksController) by calling
   * the same settlement services under `withSystemScope`, so async tenders
   * (terminal / QR / deposit / subscription / refund / Connect status) settle
   * deterministically. Safe tier: touches only the caller's seeded org, makes no
   * outbound call. Pairs with STRIPE_E2E_STUB, which makes the create-leg
   * deterministic in the first place.
   */
  async simulateStripeWebhook(input: {
    eventType:
      | 'checkout.session.completed'
      | 'checkout.session.expired'
      | 'payment_intent.succeeded'
      | 'payment_intent.payment_failed'
      | 'charge.refunded'
      | 'account.updated'
      | 'customer.subscription.updated'
      | 'customer.subscription.deleted';
    metadata?: Record<string, string>;
    paymentIntentId?: string;
    checkoutSessionId?: string;
    amountRefundedCents?: number;
    amountCapturedCents?: number;
    stripeAccountId?: string;
    chargesEnabled?: boolean;
    payoutsEnabled?: boolean;
    detailsSubmitted?: boolean;
    stripeSubscriptionId?: string;
    stripeStatus?: string;
    currentPeriodEndSec?: number;
  }): Promise<{
    received: boolean;
    processed: boolean;
    action: string;
    message?: string;
  }> {
    const { eventType, metadata } = input;
    const metadataType = metadata?.type;

    try {
      // Connect account status (onboarding completion)
      if (eventType === 'account.updated') {
        if (!input.stripeAccountId) {
          return {
            received: true,
            processed: false,
            action: 'ignored',
            message: 'stripeAccountId required for account.updated',
          };
        }
        // Lazy import so the feature barrel (which transitively loads the email
        // env) isn't pulled into this module's top-level graph — that breaks
        // testing.service unit specs that don't provide email env vars.
        const { syncStripeAccountStatus } = await import(
          '@borradh-workspace/features/integrations'
        );
        const result = await withSystemScope(
          (conn) =>
            syncStripeAccountStatus(conn, {
              stripeAccountId: input.stripeAccountId as string,
              chargesEnabled: input.chargesEnabled ?? true,
              payoutsEnabled: input.payoutsEnabled ?? true,
              detailsSubmitted: input.detailsSubmitted ?? true,
              email: null,
              businessName: null,
              defaultCurrency: null,
              requirementsCurrentlyDue: null,
              disabledReason: null,
            }),
          { db }
        );
        if (!result.success) {
          return {
            received: true,
            processed: false,
            action: 'error',
            message: result.error.message,
          };
        }
        const synced = result.data !== null;
        return {
          received: true,
          processed: synced,
          action: synced ? 'account_synced' : 'ignored',
        };
      }

      // Recurring-membership subscription lifecycle
      if (
        eventType === 'customer.subscription.updated' ||
        eventType === 'customer.subscription.deleted'
      ) {
        if (!input.stripeSubscriptionId) {
          return {
            received: true,
            processed: false,
            action: 'ignored',
            message: 'stripeSubscriptionId required for subscription events',
          };
        }
        const { handleMembershipSubscriptionWebhook } = await import(
          '@borradh-workspace/features/memberships'
        );
        const result = await withSystemScope(
          (conn) =>
            handleMembershipSubscriptionWebhook(conn, {
              eventType,
              stripeSubscriptionId: input.stripeSubscriptionId as string,
              stripeStatus:
                input.stripeStatus ??
                (eventType === 'customer.subscription.deleted'
                  ? 'canceled'
                  : 'active'),
              currentPeriodEnd: input.currentPeriodEndSec
                ? new Date(input.currentPeriodEndSec * 1000)
                : null,
            }),
          { db }
        );
        if (!result.success) {
          return {
            received: true,
            processed: false,
            action: 'error',
            message: result.error.message,
          };
        }
        return {
          received: true,
          processed: result.data.processed,
          action: result.data.action,
        };
      }

      // Sale tender (terminal / manual_card / QR / sale refund)
      if (metadataType === 'sale_payment') {
        const { handleSalePaymentWebhook } = await import(
          '@borradh-workspace/features/sales'
        );
        const result = await withSystemScope(
          (conn) =>
            handleSalePaymentWebhook(conn, {
              eventType: eventType as
                | 'checkout.session.completed'
                | 'checkout.session.expired'
                | 'charge.refunded'
                | 'payment_intent.succeeded'
                | 'payment_intent.payment_failed',
              paymentIntentId: input.paymentIntentId,
              metadata,
              amountRefundedCents: input.amountRefundedCents,
              amountCapturedCents: input.amountCapturedCents,
            }),
          { db }
        );
        if (!result.success) {
          return {
            received: true,
            processed: false,
            action: 'error',
            message: result.error.message,
          };
        }
        return {
          received: true,
          processed: result.data.processed,
          action: result.data.action,
        };
      }

      // General-purpose payment
      if (metadataType === 'payment') {
        const { handlePaymentWebhook } = await import(
          '@borradh-workspace/features/payments'
        );
        const result = await withSystemScope(
          (conn) =>
            handlePaymentWebhook(conn, {
              eventType: eventType as
                | 'checkout.session.completed'
                | 'checkout.session.expired'
                | 'charge.refunded',
              checkoutSessionId: input.checkoutSessionId,
              paymentIntentId: input.paymentIntentId,
              metadata,
            }),
          { db }
        );
        if (!result.success) {
          return {
            received: true,
            processed: false,
            action: 'error',
            message: result.error.message,
          };
        }
        return {
          received: true,
          processed: result.data.processed,
          action: result.data.action ?? 'processed',
        };
      }

      // Appointment deposit (explicit metadata.type)
      if (metadataType === 'appointment_deposit') {
        const { handleDepositWebhook } = await import(
          '@borradh-workspace/features/appointments'
        );
        const result = await withSystemScope(
          (conn) =>
            handleDepositWebhook(conn, {
              eventType: eventType as
                | 'checkout.session.completed'
                | 'checkout.session.expired'
                | 'charge.refunded',
              checkoutSessionId: input.checkoutSessionId,
              paymentIntentId: input.paymentIntentId,
              metadata,
            }),
          { db }
        );
        if (!result.success) {
          return {
            received: true,
            processed: false,
            action: 'error',
            message: result.error.message,
          };
        }
        return {
          received: true,
          processed: result.data.processed,
          action: result.data.action ?? 'processed',
        };
      }

      return {
        received: true,
        processed: false,
        action: 'ignored',
        message: `No route for eventType=${eventType} metadata.type=${metadataType ?? 'none'}`,
      };
    } catch (error) {
      logError('testing.simulateStripeWebhook', error, { feature: 'testing' });
      return {
        received: true,
        processed: false,
        action: 'error',
        message: `Failed to simulate stripe webhook: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Seed a Stripe Connect integration row so card / QR / deposit tenders find an
   * active connected account. Pairs with STRIPE_E2E_STUB — the `acct_e2e_*` id
   * is never sent to real Stripe. Destructive tier (writes a row). Idempotent
   * per org (unique organization_id). The enabled flags default true but can be
   * seeded incomplete to test the onboarding-completion (account.updated) flow.
   *
   * Pass a real `stripeAccountId` (via the connected-org fixture) to seed a
   * genuinely-connected org for preview — see seedConnectedStripeConnect.
   */
  async seedStripeConnect(input: {
    organizationId: string;
    // A REAL connected account id (acct_…) to seed — used by the connected-org
    // fixture so preview shows a genuinely-connected org (no "Set up payments"
    // → account-link 500). When omitted, a fabricated acct_e2e_… id is used,
    // which is fine for specs that only assert the DB-backed status.
    stripeAccountId?: string;
    defaultCurrency?: string;
    chargesEnabled?: boolean;
    payoutsEnabled?: boolean;
    detailsSubmitted?: boolean;
    isActive?: boolean;
  }): Promise<{ success: boolean; stripeAccountId: string; message: string }> {
    try {
      const chargesEnabled = input.chargesEnabled ?? true;
      const payoutsEnabled = input.payoutsEnabled ?? true;
      const detailsSubmitted = input.detailsSubmitted ?? true;
      const isActive = input.isActive ?? true;
      const stripeAccountId =
        input.stripeAccountId ?? `acct_e2e_${this.generateId()}`;

      const [row] = await withSystemScope(
        (conn) =>
          conn
            .insert(stripeConnectIntegration)
            .values({
              organizationId: input.organizationId,
              stripeAccountId,
              accountType: 'controller',
              chargesEnabled,
              payoutsEnabled,
              detailsSubmitted,
              isActive,
              defaultCurrency: input.defaultCurrency ?? 'eur',
            })
            .onConflictDoUpdate({
              target: stripeConnectIntegration.organizationId,
              set: {
                // Update the account id too, so seeding the real account over a
                // fabricated one (or vice-versa) converges.
                stripeAccountId,
                chargesEnabled,
                payoutsEnabled,
                detailsSubmitted,
                isActive,
                updatedAt: new Date(),
              },
            })
            .returning(),
        { db }
      );

      return {
        success: true,
        stripeAccountId: row.stripeAccountId,
        message: `Stripe Connect seeded for org: ${input.organizationId}`,
      };
    } catch (error) {
      logError('testing.seedStripeConnect', error, { feature: 'testing' });
      return {
        success: false,
        stripeAccountId: '',
        message: `Failed to seed stripe connect: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Look up the org's current open sale + its payment rows so an E2E spec can
   * inject the settlement webhook for an async tender (QR / terminal / deposit)
   * by its `salePaymentId`. Safe tier (read-only).
   */
  async getOpenSale(organizationId: string): Promise<{
    success: boolean;
    saleId?: string;
    currency?: string;
    payments?: Array<{
      id: string;
      method: string;
      status: string;
      amountCents: number;
      stripePaymentIntentId: string | null;
    }>;
    message?: string;
  }> {
    try {
      const openSale = await withSystemScope(
        (conn) =>
          conn.query.sale.findFirst({
            where: (t, { and: andOp, eq: eqOp }) =>
              andOp(
                eqOp(t.organizationId, organizationId),
                eqOp(t.status, 'open')
              ),
            orderBy: (t, { desc: descOp }) => [descOp(t.createdAt)],
            with: { payments: true },
          }),
        { db }
      );
      if (!openSale) {
        return { success: false, message: 'No open sale for organization' };
      }
      return {
        success: true,
        saleId: openSale.id,
        currency: openSale.currency,
        payments: openSale.payments.map((p) => ({
          id: p.id,
          method: p.method,
          status: p.status,
          amountCents: p.amountCents,
          stripePaymentIntentId: p.stripePaymentIntentId ?? null,
        })),
      };
    } catch (error) {
      logError('testing.getOpenSale', error, { feature: 'testing' });
      return {
        success: false,
        message: `Failed to get open sale: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Force a REAL Messenger delivery failure to exercise the delivery-failure
   * handling path. Unlike simulateWebhook this runs with
   * `skipExternalDelivery=false`, so the worker generates a reply and attempts
   * a real Meta Send API call to a deliberately-invalid PSID, which Meta
   * rejects (e.g. `not_found` / "no matching user"). This deterministically
   * reproduces the cold lead-form-PSID bug: the new code should escalate the
   * conversation (reason: `delivery_failed`), emit `conversation_delivery_failed`,
   * and capture the exact Meta error code in logs/Sentry — without waiting for
   * real failing ad traffic.
   *
   * `pageId` must be a REAL connected Meta page (so a page access token exists
   * to make the outbound call). Destructive-gated in the controller: it makes a
   * real outbound Meta call, so it must never run on a real production host.
   */
  async forceMessengerDeliveryFailure(input: {
    pageId: string;
    senderId?: string;
    messageText?: string;
  }): Promise<{
    success: boolean;
    conversationId?: string;
    messageId?: string;
    senderId: string;
    message: string;
  }> {
    // Numeric-but-invalid PSID → Meta responds "no matching user" (not_found).
    const senderId = input.senderId ?? `9${Date.now()}0`;
    try {
      const result = await withSystemScope(
        (conn) =>
          handleIncomingMessage(conn, {
            pageId: input.pageId,
            senderId,
            senderName: 'Delivery Failure Test',
            messageText: input.messageText ?? 'hi',
            messageId: `mid.forcefail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            platform: 'facebook_messenger',
            timestamp: Date.now(),
            queueDelayMs: 0,
            // The whole point: let the real Meta send run (and fail).
            skipExternalDelivery: false,
          }),
        { db }
      );

      if (!result.success) {
        return {
          success: false,
          senderId,
          message: `handleIncomingMessage failed: ${result.error.message}`,
        };
      }

      return {
        success: true,
        conversationId: result.data.conversationId,
        messageId: result.data.messageId,
        senderId,
        message:
          'Inbound recorded with a bogus PSID and a REAL bot reply queued. Within ~15s the Meta send should fail — watch for "Recipient unavailable" / conversation_delivery_failed and the conversation flipping to agent_handling (reason: delivery_failed).',
      };
    } catch (error) {
      logError('testing.forceMessengerDeliveryFailure', error, {
        feature: 'testing',
      });
      return {
        success: false,
        senderId,
        message: `Failed to force delivery failure: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Simulate an assistant (Claire) chat message by running a single turn
   * headlessly — no SSE stream, no streaming controller.
   *
   * This is the assistant analogue of `simulateWebhook`: it gives E2E tests a
   * deterministic injection path into the LLM-driven assistant. The key knob
   * is `forceSkillIds`, which bypasses the first-turn `classifyIntent` (Haiku)
   * router so a test can target one skill's tools deterministically. The
   * public `/assistant/chat` controller does NOT expose this override — it
   * lives only on this testing path, keeping the production attack surface
   * unchanged.
   *
   * The model is still invoked for real (tool-argument generation within the
   * forced skill is non-deterministic). Tests should assert on the SHAPE of
   * the side effect (which tool fired, a row created for this org) rather than
   * exact model wording.
   *
   * Tools that call back into the API via `apiFetch` (e.g. createService,
   * createLead) need an authenticated cookie — pass `sessionToken` and it's
   * forwarded as `__Secure-better-auth.session_token`. Tools that write
   * directly via `db` (e.g. `meta_remember`) don't need it.
   */
  async simulateAssistantMessage(input: {
    organizationId: string;
    userId: string;
    conversationId?: string;
    messageText: string;
    forceSkillIds?: string[];
    sessionToken?: string;
  }): Promise<{
    success: boolean;
    conversationId?: string;
    assistantText?: string;
    toolCalls?: HeadlessTurnToolCall[];
    streamError?: RunHeadlessTurnResult['streamError'];
    message: string;
  }> {
    try {
      // Resolve (or create) a conversation row so the turn is anchored to a
      // real conversation — mirrors the controller, which always operates on
      // a persisted conversation.
      let conversationId = input.conversationId;
      if (!conversationId) {
        const convResult = await withSystemScope(
          (conn) =>
            createConversation(conn, {
              organizationId: input.organizationId,
              userId: input.userId,
            }),
          { db }
        );
        if (!convResult.success) {
          return {
            success: false,
            message: `Failed to create conversation: ${convResult.error.message}`,
          };
        }
        conversationId = convResult.data.id;
      }

      // Build the session cookie for apiFetch'd tools. The AuthGuard reads
      // `__Secure-better-auth.session_token` (cookie) or a Bearer header;
      // apiFetch only forwards the cookie, so set that name.
      const cookie = input.sessionToken
        ? `__Secure-better-auth.session_token=${input.sessionToken}`
        : '';

      // runHeadlessTurn loads the assistant context in-process via
      // getAssistantContext, which uses withOrgScope. Establish the org RLS
      // context (as a real authenticated turn would, via RlsInterceptor) so
      // that in-process read runs as app_authenticated for THIS org rather than
      // fail-fasting / missing the org. The turn's tools self-call over HTTP and
      // get their own context from the forwarded session cookie.
      const result = await runWithRlsContext(
        { organizationId: input.organizationId, userId: input.userId },
        () =>
          runHeadlessTurn({
            organizationId: input.organizationId,
            userId: input.userId,
            conversationId,
            messageText: input.messageText,
            forceSkillIds: input.forceSkillIds,
            cookie,
          })
      );

      return {
        success: true,
        conversationId: result.conversationId,
        assistantText: result.assistantText,
        toolCalls: result.toolCalls,
        streamError: result.streamError,
        message: result.streamError
          ? `Assistant turn completed with stream error (${result.streamError.category})`
          : 'Assistant message simulated successfully',
      };
    } catch (error) {
      logError('testing.simulateAssistantMessage', error, {
        feature: 'testing',
      });
      return {
        success: false,
        message: `Failed to simulate assistant message: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Simulate a full Claire-on-WhatsApp owner turn (WS-10) with a MOCKED
   * WhatsAppCloudService that captures the outbound sends. The Phase-2
   * integration gate — drives the real worker process function (find/create
   * conversation → buildClaireTurnInputs → runClaireTurn → render → "deliver")
   * but captures the sends instead of hitting the real number. Media resolution
   * is stubbed so no S3 fetch is required.
   */
  async simulateClaireWhatsappTurn(input: {
    organizationId?: string;
    userId?: string;
    fromPhone?: string;
    message: string;
  }): Promise<{
    success: boolean;
    conversationId?: string;
    sends?: ClaireWhatsappTurnResult['sends'];
    finalText?: string;
    message: string;
  }> {
    try {
      // Resolve the paired owner from fromPhone if userId/org not given.
      let userId = input.userId;
      let organizationId = input.organizationId;
      if ((!userId || !organizationId) && input.fromPhone) {
        const ownerResult = await withSystemScope(
          (conn) => resolveOwnerByPhone(conn, input.fromPhone as string),
          { db }
        );
        if (!ownerResult.success || !ownerResult.data) {
          return {
            success: false,
            message: `No paired owner for phone ${input.fromPhone}`,
          };
        }
        userId = ownerResult.data.userId;
        organizationId = ownerResult.data.organizationId;
      }

      if (!userId || !organizationId) {
        return {
          success: false,
          message: 'userId+organizationId or fromPhone required',
        };
      }

      const fromPhoneE164 = input.fromPhone ?? 'e2e-claire-owner';

      // Capture sends instead of delivering to the real number.
      const captured: ClaireWhatsappTurnResult['sends'] = [];
      const captureService = {
        sendTextMessage: async (_to: string, body: string) => {
          captured.push({ kind: 'text' as const, body });
          return { messageId: 'mock', success: true };
        },
        sendMediaMessage: async (
          _to: string,
          opts: { type: 'image' | 'video'; link: string; caption?: string }
        ) => {
          captured.push({
            kind: 'media' as const,
            mediaType: opts.type,
            link: opts.link,
            ...(opts.caption ? { caption: opts.caption } : {}),
          });
          return { messageId: 'mock', success: true };
        },
        sendInteractiveMessage: async (
          _to: string,
          opts: {
            type: 'list';
            header?: string;
            body: string;
            footer?: string;
            buttonText: string;
            sections: Array<{
              title?: string;
              rows: Array<{
                id: string;
                title: string;
                description?: string;
              }>;
            }>;
          }
        ) => {
          captured.push({
            kind: 'interactive_list' as const,
            header: opts.header,
            body: opts.body,
            footer: opts.footer,
            buttonText: opts.buttonText,
            sections: opts.sections,
          });
          return { messageId: 'mock', success: true };
        },
      };

      const result = await runWithRlsContext({ organizationId, userId }, () =>
        processClaireWhatsappTurn(
          {
            userId: userId as string,
            organizationId: organizationId as string,
            fromPhoneE164,
            userMessage: input.message,
            inboundMessageId: `e2e-${randomUUID()}`,
          },
          {
            whatsappService: captureService,
            // Skip S3 — preview media resolution returns nothing (text-only).
            resolvePreviewMediaFn: async () => [],
          }
        )
      );

      return {
        success: true,
        conversationId: result.conversationId,
        sends: result.sends,
        finalText: result.finalText,
        message: 'Claire WhatsApp turn simulated successfully',
      };
    } catch (error) {
      logError('testing.simulateClaireWhatsappTurn', error, {
        feature: 'testing',
      });
      return {
        success: false,
        message: `Failed to simulate Claire WhatsApp turn: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Get conversation messages for test assertions.
   */
  async getConversationMessages(
    conversationId: string,
    limit = 20
  ): Promise<{
    success: boolean;
    messages?: Array<{
      id: string;
      role: string;
      content: string | null;
      metadata: unknown;
      createdAt: Date;
    }>;
    message: string;
  }> {
    try {
      const messages = await withSystemScope(
        (conn) =>
          conn
            .select({
              id: conversationMessage.id,
              role: conversationMessage.role,
              content: conversationMessage.content,
              metadata: conversationMessage.metadata,
              createdAt: conversationMessage.createdAt,
            })
            .from(conversationMessage)
            .where(eq(conversationMessage.conversationId, conversationId))
            .orderBy(desc(conversationMessage.createdAt))
            .limit(limit),
        { db }
      );

      return {
        success: true,
        messages,
        message: `Found ${messages.length} messages`,
      };
    } catch (error) {
      logError('testing.getConversationMessages', error, {
        feature: 'testing',
      });
      return {
        success: false,
        message: `Failed to get messages: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Get the organization ID for a user by email (first org found).
   * More reliable than session-based lookup after onboarding.
   */
  async getOrganizationByEmail(email: string): Promise<{
    success: boolean;
    organizationId?: string;
    userId?: string;
    message: string;
  }> {
    try {
      const users = await withSystemScope(
        (conn) =>
          conn
            .select({ id: user.id })
            .from(user)
            .where(eq(user.email, email))
            .limit(1),
        { db }
      );

      if (users.length === 0) {
        return { success: false, message: 'User not found' };
      }

      const memberships = await withSystemScope(
        (conn) =>
          conn
            .select({ organizationId: member.organizationId })
            .from(member)
            .where(eq(member.userId, users[0].id))
            .limit(1),
        { db }
      );

      if (memberships.length === 0) {
        return { success: false, message: 'No organizations found for user' };
      }

      return {
        success: true,
        organizationId: memberships[0].organizationId,
        userId: users[0].id,
        message: 'Organization found',
      };
    } catch (error) {
      logError('testing.getOrganizationByEmail', error, { feature: 'testing' });
      return {
        success: false,
        message: `Failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Delete all organizations (and cascaded data) for a user by email.
   * Used to reset a user to pre-onboarding state for auth setup tests.
   */
  async deleteUserOrganizations(email: string): Promise<{
    success: boolean;
    message: string;
    deleted?: { organizations: number };
  }> {
    try {
      // Find the user
      const users = await withSystemScope(
        (conn) =>
          conn
            .select({ id: user.id })
            .from(user)
            .where(eq(user.email, email))
            .limit(1),
        { db }
      );

      if (users.length === 0) {
        return {
          success: true,
          message: 'User not found, nothing to delete',
          deleted: { organizations: 0 },
        };
      }

      const userId = users[0].id;

      // Find all organizations the user is a member of
      const memberOrgs = await withSystemScope(
        (conn) =>
          conn
            .select({ organizationId: member.organizationId })
            .from(member)
            .where(eq(member.userId, userId)),
        { db }
      );

      if (memberOrgs.length === 0) {
        return {
          success: true,
          message: 'No organizations found',
          deleted: { organizations: 0 },
        };
      }

      const orgIds = memberOrgs.map((m) => m.organizationId);

      // Delete organizations (cascades all feature data)
      const result = await withSystemScope(
        (conn) =>
          conn
            .delete(organization)
            .where(inArray(organization.id, orgIds))
            .returning({ id: organization.id }),
        { db }
      );

      this.logger.log(
        `Deleted ${result.length} organizations for user: ${email}`
      );

      return {
        success: true,
        message: `Deleted ${result.length} organizations`,
        deleted: { organizations: result.length },
      };
    } catch (error) {
      logError('testing.deleteUserOrganizations', error, {
        feature: 'testing',
      });
      return {
        success: false,
        message: `Failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Cleans up all E2E test data.
   * Removes all records with IDs starting with 'e2e_test_'.
   * @deprecated Use cleanupByEmailPattern instead for more reliable cleanup.
   */
  async cleanupTestData(): Promise<{
    success: boolean;
    message: string;
    deleted?: {
      members: number;
      organizations: number;
      users: number;
    };
  }> {
    try {
      this.logger.log('Starting E2E test data cleanup...');

      // Delete in order of dependencies (members first, then orgs, then users)
      const deletedMembers = await withSystemScope(
        (conn) =>
          conn
            .delete(member)
            .where(like(member.id, `${this.E2E_PREFIX}%`))
            .returning(),
        { db }
      );

      const deletedOrgs = await withSystemScope(
        (conn) =>
          conn
            .delete(organization)
            .where(like(organization.id, `${this.E2E_PREFIX}%`))
            .returning(),
        { db }
      );

      const deletedUsers = await withSystemScope(
        (conn) =>
          conn
            .delete(user)
            .where(like(user.id, `${this.E2E_PREFIX}%`))
            .returning(),
        { db }
      );

      this.logger.log(
        `E2E test data cleaned up: ${deletedMembers.length} members, ${deletedOrgs.length} orgs, ${deletedUsers.length} users`
      );

      return {
        success: true,
        message: 'Test data cleaned up successfully',
        deleted: {
          members: deletedMembers.length,
          organizations: deletedOrgs.length,
          users: deletedUsers.length,
        },
      };
    } catch (error) {
      logError('testing.cleanup', error, { feature: 'testing' });
      return {
        success: false,
        message: `Failed to cleanup test data: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Ensure the chatbot is enabled for a specific Meta Ads page.
   * Used before webhook tests to guarantee the chatbot will process messages.
   */
  async ensureChatbotEnabled(pageId: string): Promise<{
    success: boolean;
    message: string;
    wasAlreadyEnabled?: boolean;
  }> {
    try {
      const page = await withSystemScope(
        (conn) =>
          conn.query.metaAdsPage.findFirst({
            where: eq(metaAdsPage.pageId, pageId),
            columns: { id: true, isChatbotActive: true, pageId: true },
          }),
        { db }
      );

      if (!page) {
        return {
          success: false,
          message: `No Meta Ads page found with pageId: ${pageId}`,
        };
      }

      if (page.isChatbotActive) {
        return {
          success: true,
          message: 'Chatbot already enabled',
          wasAlreadyEnabled: true,
        };
      }

      await withSystemScope(
        (conn) =>
          conn
            .update(metaAdsPage)
            .set({ isChatbotActive: true })
            .where(eq(metaAdsPage.id, page.id)),
        { db }
      );

      this.logger.log(`Enabled chatbot for page ${pageId}`);
      return {
        success: true,
        message: 'Chatbot enabled',
        wasAlreadyEnabled: false,
      };
    } catch (error) {
      logError('testing.ensureChatbotEnabled', error, { feature: 'testing' });
      return {
        success: false,
        message: `Failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Update organization settings directly.
   * Bypasses auth guards for E2E testing.
   */
  async updateOrgSettings(input: {
    organizationId: string;
    bookingDestination?: 'borradh' | 'external_link';
    defaultBookingLink?: string | null;
  }): Promise<{ success: boolean; message: string }> {
    try {
      const updates: Record<string, unknown> = {};
      if (input.bookingDestination !== undefined) {
        updates.bookingDestination = input.bookingDestination;
        // Both columns move together while they coexist (ENG-500 expand/
        // contract). This endpoint writes the row directly, so setting only
        // one left the org disagreeing with itself — and since the read path
        // prefers `bookingDestination`, a test that set only the legacy column
        // configured nothing at all.
        updates.primaryCalendarType =
          input.bookingDestination === 'borradh' ? 'borradh' : null;
      }
      if (input.defaultBookingLink !== undefined)
        updates.defaultBookingLink = input.defaultBookingLink;

      await withSystemScope(
        (conn) =>
          conn
            .update(organization)
            .set(updates)
            .where(eq(organization.id, input.organizationId)),
        { db }
      );

      return { success: true, message: 'Organization settings updated' };
    } catch (error) {
      logError('testing.updateOrgSettings', error, { feature: 'testing' });
      return {
        success: false,
        message: `Failed to update org settings: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Get the status of a conversation by ID.
   * Used by targeting tests to verify bot activation vs agent_handling.
   */
  async getConversationStatus(
    conversationId: string
  ): Promise<{ success: boolean; status: string | null }> {
    try {
      const conv = await withSystemScope(
        (conn) =>
          conn.query.conversation.findFirst({
            where: eq(conversation.id, conversationId),
            columns: { status: true },
          }),
        { db }
      );
      return { success: true, status: conv?.status ?? null };
    } catch (error) {
      logError('testing.getConversationStatus', error, { feature: 'testing' });
      return { success: true, status: null };
    }
  }

  /**
   * Update chatbot settings directly.
   * Bypasses auth guards for E2E testing.
   */
  async updateChatbotSettings(input: {
    organizationId: string;
    chatbotSystemPrompt?: string | null;
    chatbotSettings?: Record<string, unknown>;
  }): Promise<{ success: boolean; message: string }> {
    try {
      const updates: Record<string, unknown> = {};
      if (input.chatbotSystemPrompt !== undefined)
        updates.chatbotSystemPrompt = input.chatbotSystemPrompt;

      // Merge chatbotSettings into existing JSON (preserving unset fields)
      if (input.chatbotSettings !== undefined) {
        const existing = await withSystemScope(
          (conn) =>
            conn.query.organization.findFirst({
              where: eq(organization.id, input.organizationId),
              columns: { chatbotSettings: true },
            }),
          { db }
        );
        const current =
          (existing?.chatbotSettings as Record<string, unknown>) ?? {};
        updates.chatbotSettings = { ...current, ...input.chatbotSettings };
      }

      await withSystemScope(
        (conn) =>
          conn
            .update(organization)
            .set(updates)
            .where(eq(organization.id, input.organizationId)),
        { db }
      );

      return { success: true, message: 'Chatbot settings updated' };
    } catch (error) {
      logError('testing.updateChatbotSettings', error, { feature: 'testing' });
      return {
        success: false,
        message: `Failed to update chatbot settings: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Trigger the monthly content batch for an org without waiting for the
   * 1st-of-month cron. Resolves a creator (org owner, else any member) since
   * `generateMonthlyBatch` requires a `createdById`, then runs the same
   * service the cron and the "Create Batch" button call. Used by the
   * long-running image-generation E2E spec to seed real Fabric graphics.
   */
  async triggerMonthlyContentBatch(input: {
    organizationId: string;
    periodMonth?: string;
    graphicCount?: number;
    videoCount?: number;
  }): Promise<{
    success: boolean;
    message?: string;
    batchId?: string;
    graphicsSeeded?: number;
    videosSeeded?: number;
    jobsEnqueued?: number;
    failures?: string[];
    alreadyExisted?: boolean;
  }> {
    const members = await withSystemScope(
      (conn) =>
        conn.query.member.findMany({
          where: eq(member.organizationId, input.organizationId),
          columns: { userId: true, role: true },
        }),
      { db }
    );
    const creator = members.find((m) => m.role === 'owner') ?? members[0];
    if (!creator) {
      return {
        success: false,
        message: `No member found for organization ${input.organizationId}`,
      };
    }

    const result = await withSystemScope(
      (conn) =>
        generateMonthlyBatch(conn, {
          organizationId: input.organizationId,
          periodMonth: input.periodMonth,
          graphicCount: input.graphicCount ?? 4,
          videoCount: input.videoCount ?? 0,
          createdById: creator.userId,
          allowStockFootage: false,
        }),
      { db }
    );

    if (!result.success) {
      return { success: false, message: result.error.message };
    }

    return {
      success: true,
      batchId: result.data.batch.id,
      graphicsSeeded: result.data.graphicsSeeded,
      videosSeeded: result.data.videosSeeded,
      jobsEnqueued: result.data.jobsEnqueued,
      failures: result.data.failures,
      alreadyExisted: result.data.alreadyExisted,
    };
  }

  /**
   * Delete a content batch and everything it spawned. The DB only cascades
   * `content_batch_item` from `content_batch`; graphics are `set null`, so
   * they're removed explicitly here:
   *   - graphic (by the batch items' graphicIds)
   *   - content_batch — cascades content_batch_item
   */
  async cleanupContentBatch(contentBatchId: string): Promise<{
    success: boolean;
    message?: string;
    deleted?: { graphics: number };
  }> {
    try {
      // Every attempt, not just the current one: a slot that was regenerated
      // owns a graphic per cut, and cleanup has to take all of them.
      const items = await withSystemScope(
        (conn) =>
          conn.query.contentAttempt.findMany({
            where: eq(contentAttempt.batchId, contentBatchId),
            columns: { graphicId: true },
          }),
        { db }
      );
      const graphicIds = items
        .map((i) => i.graphicId)
        .filter((id): id is string => !!id);

      if (graphicIds.length > 0) {
        await withSystemScope(
          (conn) => conn.delete(graphic).where(inArray(graphic.id, graphicIds)),
          { db }
        );
      }

      await withSystemScope(
        (conn) =>
          conn.delete(contentBatch).where(eq(contentBatch.id, contentBatchId)),
        { db }
      );

      return { success: true, deleted: { graphics: graphicIds.length } };
    } catch (error) {
      logError('testing.cleanupContentBatch', error, { feature: 'testing' });
      return {
        success: false,
        message: `Failed to cleanup content batch: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * PRD-46 — synthetic pool-wedge reproducer + mitigation verifier.
   *
   * Opens `connections` concurrent transactions that each run a statement, sit
   * IDLE for `idleHoldMs`, then run another statement. Every `db.transaction()`
   * is wrapped (packages/database client.ts) to set
   * `SET LOCAL idle_in_transaction_session_timeout = '10s'` — the guard against
   * the Fly↔Neon orphaned-transaction wedge (a NAT-severed connection leaves a
   * backend `idle in transaction` forever, starving the pool → the recurring
   * "DB connections saturated / database:down while Neon is healthy" incident).
   *
   * With the guard active, Postgres terminates each idle backend at ~10s, so the
   * follow-up statement throws ("terminating connection due to idle-in-transaction
   * timeout") and the connection returns to the pool — the wedge SELF-HEALS.
   * `reaped === requested` ⇒ the mitigation is working. If it regressed (the
   * SET LOCAL removed), the idle txns survive the full `idleHoldMs` and
   * `reaped < requested`.
   *
   * This is meant to run against the REAL pooled target (PgBouncer/Neon via the
   * load-test API), which is where the wedge actually happens — plain-Postgres
   * integration tests can't represent transaction-mode pooling. It only HOLDS
   * connections; it mutates no data, and is bounded + self-healing (the reap, or
   * `idleHoldMs`, whichever first). The default `connections` stays below the
   * pool max so the box stays responsive; raise it to ≥ the pool max to also
   * reproduce full pool exhaustion (which briefly makes the box unresponsive).
   */
  async holdIdleTransactions(input: {
    connections?: number;
    idleHoldMs?: number;
  }): Promise<{
    requested: number;
    idleHoldMs: number;
    expectedReapWithinMs: number;
    reaped: number;
    survived: number;
    mitigationActive: boolean;
    perConnection: Array<{
      index: number;
      reaped: boolean;
      elapsedMs: number;
      error?: string;
    }>;
  }> {
    // Clamp hard: ≤20 connections (never a runaway), idle hold in [1s, 30s].
    // The default 12s exceeds the 10s idle cap so a healthy guard reaps it.
    const connections = Math.min(
      Math.max(Math.trunc(input.connections ?? 4), 1),
      20
    );
    const idleHoldMs = Math.min(
      Math.max(Math.trunc(input.idleHoldMs ?? 12_000), 1_000),
      30_000
    );
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    this.logger.warn(
      `holdIdleTransactions: opening ${connections} idle txns for ${idleHoldMs}ms (pool-wedge reproducer)`
    );

    const perConnection = await Promise.all(
      Array.from({ length: connections }, (_unused, index) =>
        (async () => {
          const start = Date.now();
          try {
            await db.transaction(async (tx) => {
              await tx.execute(sql`SELECT 1`); // open + first stmt -> now idle
              await sleep(idleHoldMs); // sit idle; the guard reaps at ~10s
              await tx.execute(sql`SELECT 1`); // probe: throws if backend was terminated
            });
            return { index, reaped: false, elapsedMs: Date.now() - start };
          } catch (error) {
            return {
              index,
              reaped: true,
              elapsedMs: Date.now() - start,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })()
      )
    );

    const reaped = perConnection.filter((c) => c.reaped).length;
    return {
      requested: connections,
      idleHoldMs,
      expectedReapWithinMs: 10_000, // TRANSACTION_IDLE_TIMEOUT in client.ts
      reaped,
      survived: connections - reaped,
      mitigationActive: reaped === connections,
      perConnection,
    };
  }

  /**
   * Seed the platform admin the admin-terminal E2E needs: a real, verified
   * user carrying the id from ADMIN_USER_IDS, a password it can sign in with,
   * and a TOTP secret the spec can derive live codes from.
   *
   * The id is not the caller's choice. `GlobalAdminGuard` and Better Auth's
   * admin plugin both read ADMIN_USER_IDS, and the plugin captures it at
   * import — so the admin has to BE that id, and only the server knows it.
   *
   * Returns the TOTP secret in plaintext. That is the whole point: it lets the
   * spec exercise the REAL `verify-2fa` endpoint instead of stubbing the gate,
   * which is where the production failure actually surfaced. Guarded by
   * DestructiveTestingGuard (seed token AND non-production).
   */
  async seedPlatformAdmin(input: { email: string; password: string }) {
    const adminId = authEnv.ADMIN_USER_IDS[0];
    if (!adminId) {
      throw new Error('ADMIN_USER_IDS is empty — nothing to seed against');
    }

    // `role: 'admin'` below is NOT redundant with ADMIN_USER_IDS — the two
    // guards read different fields. The API's `GlobalAdminGuard` checks
    // ADMIN_USER_IDS, while the SPA's `_admin` route redirects to
    // /dashboard/home unless `session.user.role === 'admin'`. Seed only the
    // former and the backend admits you while the frontend bounces you out
    // before any admin UI renders.
    // UPSERT, not check-then-insert. Playwright workers seed concurrently
    // against this one fixed id, so a `findFirst` + `insert` pair races: both
    // workers read "absent", both insert, and the loser gets
    // `duplicate key value violates unique constraint "user_pkey"` — a 500 out
    // of a seed helper the specs treat as infallible, which then fails a test
    // for a reason that has nothing to do with what it asserts. Observed
    // locally: one 500 immediately followed by a 200 for the same call.
    //
    // Same reasoning as the account UPDATE-in-place below; this half was simply
    // missed. Letting Postgres resolve the conflict removes the window rather
    // than narrowing it.
    await db
      .insert(user)
      .values({
        id: adminId,
        name: 'E2E Platform Admin',
        email: input.email,
        emailVerified: true,
        twoFactorEnabled: true,
        role: 'admin',
      })
      .onConflictDoUpdate({
        target: user.id,
        set: {
          email: input.email,
          emailVerified: true,
          twoFactorEnabled: true,
          role: 'admin',
        },
      });

    // A credential account so the spec can sign in through the real endpoint.
    const ctx = await auth.$context;
    const hashed = await ctx.password.hash(input.password);
    // UPDATE in place rather than delete-then-insert. Playwright workers seed
    // concurrently against this one row, and a delete/insert pair opens a
    // window where the account simply does not exist — a sign-in landing in
    // that gap fails for a reason no assertion can explain.
    const existingAccount = await db.query.account.findFirst({
      where: and(
        eq(account.userId, adminId),
        eq(account.providerId, 'credential')
      ),
    });
    if (existingAccount) {
      await db
        .update(account)
        .set({ password: hashed, updatedAt: new Date() })
        .where(eq(account.id, existingAccount.id));
    } else {
      await db.insert(account).values({
        id: randomUUID(),
        accountId: adminId,
        providerId: 'credential',
        userId: adminId,
        password: hashed,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Better Auth stores the TOTP secret ENCRYPTED with the auth secret and
    // decrypts it on verify, so seeding a plaintext secret would fail every
    // code. Encrypt it the same way the enable-2FA route does.
    //
    // DERIVED, not random. Playwright runs its workers in parallel and each one
    // seeds in its own `beforeAll`, all against this single fixed admin id. A
    // random secret makes those seeds fight: worker B replaces the two_factor
    // row while worker A is mid-sign-in, and A's codes stop verifying. Deriving
    // it from the id makes every concurrent seed converge on the same value, so
    // the race becomes a no-op instead of a flake.
    const totpSecret = createHmac('sha256', authEnv.BETTER_AUTH_SECRET)
      .update(`e2e-platform-admin-totp:${adminId}`)
      .digest('base64url')
      .slice(0, 32);
    // Same reasoning as the account above, and this gap was the sharper one:
    // `verifyAdminTotp` collapses EVERY failure into "Invalid TOTP code", so a
    // verify landing between the delete and the insert finds no two_factor row
    // and reports a wrong code — pointing the reader at the code, the clock and
    // the secret, none of which are at fault.
    const encryptedSecret = await symmetricEncrypt({
      key: authEnv.BETTER_AUTH_SECRET,
      data: totpSecret,
    });
    const existingTwoFactor = await db.query.twoFactor.findFirst({
      where: eq(twoFactor.userId, adminId),
    });
    if (existingTwoFactor) {
      await db
        .update(twoFactor)
        .set({ secret: encryptedSecret })
        .where(eq(twoFactor.id, existingTwoFactor.id));
    } else {
      await db.insert(twoFactor).values({
        id: randomUUID(),
        userId: adminId,
        secret: encryptedSecret,
        backupCodes: await symmetricEncrypt({
          key: authEnv.BETTER_AUTH_SECRET,
          data: JSON.stringify([]),
        }),
      });
    }

    return { userId: adminId, email: input.email, totpSecret };
  }
}
