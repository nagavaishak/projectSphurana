/**
 * Integration-test harness.
 *
 * Builds a real NestJS application around a single controller, driven over
 * HTTP by supertest, backed by the real `db` singleton (pointed at a
 * testcontainers Postgres by global-setup.ts).
 *
 * What is REAL:
 *  - the NestJS HTTP pipeline (routing, ValidationPipe, param decorators)
 *  - RoleGuard (it queries the real `member` table via the db singleton)
 *  - the feature services the controller calls (real SQL against the test DB)
 *
 * What is FAKED:
 *  - AuthGuard. We are testing RoleGuard + services + DB, NOT better-auth.
 *    The override injects a fixed identity (`request.user` +
 *    `request.activeOrganizationId`) so the rest of the stack runs unchanged.
 *
 * Approach: PER-CONTROLLER TestingModule (not the full AppModule). Reason: the
 * controllers under test are constructor-free (they use the `db` singleton and
 * call feature services directly), so booting them needs no providers. Booting
 * the full AppModule would drag in Redis/BullMQ/Meta wiring that needs infra we
 * deliberately keep out of this harness. Per-controller modules boot instantly
 * and isolate each test to exactly the guard + service + DB path it asserts.
 */
import { randomUUID } from 'node:crypto';
import {
  appointment,
  db,
  lead,
  member,
  metaAdsIntegration,
  metaAdsPage,
  offer,
  organization,
  organizationLocation,
  organizationService,
  practitioner,
  shift,
  timeEntry,
  user,
} from '@borradh-workspace/database';
import { encryptCredentials } from '@borradh-workspace/integrations';
import {
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  type Provider,
  type Type,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { ZodValidationPipe } from 'nestjs-zod';
import { AuthGuard } from '../common/guards/auth.guard.js';
import type { AuthenticatedRequest } from '../common/guards/auth.guard.js';
import { attachActiveLocation } from '../common/guards/location.guard.js';
import type { PatientPrincipal } from '../common/guards/patient-auth.guard.js';
import { PatientAuthGuard } from '../common/guards/patient-auth.guard.js';
import { RoleGuard } from '../common/guards/role.guard.js';

export interface TestIdentity {
  /** user.id to attach as request.user.id */
  userId: string;
  /** activeOrganizationId to attach to the request */
  organizationId: string | undefined;
  email?: string;
}

/**
 * A guard that impersonates the AuthGuard: it does NOT validate any session,
 * it just stamps a fixed identity onto the request so downstream guards and
 * param decorators behave as if a real user were logged in.
 *
 * The identity is mutable on the instance so a single built app can switch
 * "who am I" between requests via {@link IntegrationApp.actAs}.
 */
class FakeAuthGuard implements CanActivate {
  identity: TestIdentity = { userId: '', organizationId: undefined };

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    req.user = {
      id: this.identity.userId,
      email: this.identity.email ?? 'test@example.com',
      emailVerified: true,
    };
    req.sessionToken = 'test-session-token';
    req.activeOrganizationId = this.identity.organizationId;

    // The REAL `AuthGuard` resolves the branch here, immediately after the org,
    // and `@ActiveLocation()` reads what it leaves behind. Stamping only the
    // org left `X-Location-Id` inert in every HTTP spec — so a controller could
    // ignore the header entirely and the suite would still be green. This is
    // the real resolver, including its 404-on-foreign-location behaviour.
    await attachActiveLocation(req, this.identity.organizationId);
    return true;
  }
}

export interface IntegrationApp {
  app: INestApplication;
  /** Switch the current identity for subsequent requests. */
  actAs: (identity: TestIdentity) => void;
  close: () => Promise<void>;
}

/**
 * Build an HTTP-testable Nest app hosting a single controller, with AuthGuard
 * overridden by a configurable fake identity. RoleGuard is registered both at
 * the controller level (via its @UseGuards) and as a provider so Nest can
 * resolve it; the controllers under test all declare
 * `@UseGuards(AuthGuard, RoleGuard)`.
 */
export async function buildControllerApp(
  controller: Type<unknown>,
  initialIdentity: TestIdentity,
  // Extra providers to register alongside the controller — e.g. an
  // { provide: APP_INTERCEPTOR, useClass: ... } to exercise a global
  // interceptor in isolation, plus any token it depends on. Empty by default so
  // existing callers are unaffected.
  extraProviders: Provider[] = []
): Promise<IntegrationApp> {
  const fakeAuth = new FakeAuthGuard();
  fakeAuth.identity = initialIdentity;

  const moduleRef = await Test.createTestingModule({
    controllers: [controller as Type<object>],
    providers: [
      Reflector,
      RoleGuard,
      // Some controllers carry global-guard decorators (e.g.
      // @SkipPaidPlanCheck). Those global guards are NOT registered here, so
      // they never run — exactly what we want (we only exercise AuthGuard +
      // RoleGuard).
      ...extraProviders,
    ],
  })
    // Override the controller-level AuthGuard with our identity stamper.
    .overrideGuard(AuthGuard)
    .useValue(fakeAuth)
    .compile();

  const app = moduleRef.createNestApplication();
  // The REAL app registers `ZodValidationPipe` from nestjs-zod (main.ts). This
  // harness registered only the stock class-validator `ValidationPipe`, under a
  // comment claiming it "mirrors the global ValidationPipe the real app uses".
  // It does not. Every DTO in this API is a `createZodDto`, which carries NO
  // class-validator metadata, so the stock pipe found zero constraints and
  // validated NOTHING — which means every "invalid input -> 400" assertion in
  // this suite was really exercising the SERVICE's safeParse, never the
  // boundary, and unknown-key stripping / z.coerce / .default were untested.
  //
  // Both are registered, in this order. Global pipes run before controller and
  // method pipes; the Zod pipe parses first, and the stock pipe then sees an
  // already-parsed plain object and passes it through. Keeping the stock pipe
  // is not redundancy: `organization.controller.ts` declares the codebase's
  // only two REAL class-validator DTOs inline, and dropping it would stop
  // validating them here.
  app.useGlobalPipes(
    new ZodValidationPipe(),
    new ValidationPipe({ transform: true })
  );
  await app.init();

  return {
    app,
    actAs: (identity) => {
      fakeAuth.identity = identity;
    },
    close: () => app.close(),
  };
}

/* ------------------------------------------------------------------ */
/* The PATIENT principal — the portal's own guard, not AuthGuard.     */
/* ------------------------------------------------------------------ */

/**
 * A guard that impersonates {@link PatientAuthGuard}: it validates no session
 * and stamps a fixed {@link PatientPrincipal} onto `request.patient`, which is
 * what `@CurrentPatient()` reads.
 *
 * Faked for the same reason `FakeAuthGuard` is: the real guard resolves a
 * `patient_session` row through better-auth's SECOND instance, which this
 * suite stubs at module level (`__mocks__/auth-patient.ts`) because it is
 * ESM-only. What matters downstream is not how the principal was proven but
 * that `leadId`/`organizationId` are SERVER-derived — so pinning them here
 * exercises exactly the surface the real guard hands on.
 */
class FakePatientAuthGuard implements CanActivate {
  patient: PatientPrincipal = {
    patientAuthId: '',
    leadId: '',
    organizationId: '',
    customerAccountId: '',
  };

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      patient: PatientPrincipal;
    }>();
    req.patient = this.patient;
    return true;
  }
}

export interface PatientIntegrationApp {
  app: INestApplication;
  /** Switch which signed-in patient subsequent requests act as. */
  actAsPatient: (patient: Partial<PatientPrincipal>) => void;
  close: () => Promise<void>;
}

/**
 * Build an HTTP-testable Nest app hosting one PATIENT-portal controller, with
 * `PatientAuthGuard` overridden by a fixed principal.
 *
 * Separate from {@link buildControllerApp} rather than an option on it: the
 * two principal types must never be mixed on one route (that is the failure
 * mode most likely to leak across the org/patient boundary), and a harness
 * that could stamp both would make such a controller look testable.
 */
export async function buildPatientControllerApp(
  controller: Type<unknown>,
  initialPatient: Pick<PatientPrincipal, 'leadId' | 'organizationId'> &
    Partial<PatientPrincipal>
): Promise<PatientIntegrationApp> {
  const fakePatientAuth = new FakePatientAuthGuard();
  const resolve = (
    patient: Partial<PatientPrincipal>,
    base: PatientPrincipal
  ): PatientPrincipal => ({
    patientAuthId:
      patient.patientAuthId ?? base.patientAuthId ?? `pa_${randomUUID()}`,
    leadId: patient.leadId ?? base.leadId,
    organizationId: patient.organizationId ?? base.organizationId,
    customerAccountId:
      patient.customerAccountId ??
      base.customerAccountId ??
      `ca_${randomUUID()}`,
  });
  fakePatientAuth.patient = resolve(initialPatient, fakePatientAuth.patient);

  const moduleRef = await Test.createTestingModule({
    controllers: [controller as Type<object>],
    providers: [Reflector],
  })
    .overrideGuard(PatientAuthGuard)
    .useValue(fakePatientAuth)
    .compile();

  const app = moduleRef.createNestApplication();
  // Same pair, same order, and for the same reason as buildControllerApp:
  // every DTO here is a `createZodDto`, which the stock pipe cannot see.
  app.useGlobalPipes(
    new ZodValidationPipe(),
    new ValidationPipe({ transform: true })
  );
  await app.init();

  return {
    app,
    actAsPatient: (patient) => {
      fakePatientAuth.patient = resolve(patient, fakePatientAuth.patient);
    },
    close: () => app.close(),
  };
}

/* ------------------------------------------------------------------ */
/* Seed helpers — insert real rows so RoleGuard + services see them.  */
/* ------------------------------------------------------------------ */

export interface SeededUser {
  id: string;
  email: string;
}

/** Insert a real `user` row. */
export async function seedUser(
  overrides: Partial<typeof user.$inferInsert> = {}
): Promise<SeededUser> {
  const id = overrides.id ?? `usr_${randomUUID()}`;
  const email = overrides.email ?? `${id}@example.com`;
  await db.insert(user).values({
    id,
    name: overrides.name ?? 'Test User',
    email,
    emailVerified: true,
    ...overrides,
  });
  return { id, email };
}

/** Insert a real `organization` row. Returns its id. */
export async function seedOrganization(
  overrides: Partial<typeof organization.$inferInsert> = {}
): Promise<string> {
  const id = overrides.id ?? `org_${randomUUID()}`;
  await db.insert(organization).values({
    id,
    name: overrides.name ?? `Org ${id}`,
    slug: overrides.slug ?? `slug-${id}`,
    // business_type is NOT NULL with no default.
    businessType: overrides.businessType ?? 'other',
    ...overrides,
  });
  return id;
}

/**
 * Insert a real `member` row linking a user to an org with a role. This is
 * what RoleGuard.findFirst resolves to decide the 403/not-403 boundary.
 * `member.createdAt` is NOT NULL with no DB default — provided here.
 */
export async function seedMember(input: {
  organizationId: string;
  userId: string;
  role: 'member' | 'admin' | 'owner';
}): Promise<string> {
  const id = `mem_${randomUUID()}`;
  await db.insert(member).values({
    id,
    organizationId: input.organizationId,
    userId: input.userId,
    role: input.role,
    createdAt: new Date(),
  });
  return id;
}

/**
 * Convenience: create an org, a user, and a member row binding them at the
 * given role. Returns the ids ready to hand to {@link buildControllerApp} /
 * {@link IntegrationApp.actAs} as a {@link TestIdentity}.
 */
export async function seedOrgWithMember(
  role: 'member' | 'admin' | 'owner',
  opts: { organizationId?: string } = {}
): Promise<{ organizationId: string; userId: string; email: string }> {
  const organizationId = opts.organizationId ?? (await seedOrganization());
  const u = await seedUser();
  await seedMember({ organizationId, userId: u.id, role });
  return { organizationId, userId: u.id, email: u.email };
}

/* ------------------------------------------------------------------ */
/* Domain-entity seed helpers (for org-isolation tests, etc.)         */
/* ------------------------------------------------------------------ */

/**
 * Insert a real `organization_location` row.
 *
 * A branch is now the unit of work: a campaign takes its geo from one, and
 * `resolveCampaignLocation` refuses (VALIDATION_ERROR) for an org that has
 * none. An org seeded without a branch is therefore no longer a realistic
 * fixture for anything branch-scoped — it is a legacy state the product asks
 * the operator to fix.
 *
 * NOT folded into `seedOrganization`: several specs assert exact location
 * counts (`website-analysis-scan.int-spec.ts`) or destructure the first row,
 * and giving all 66 org-seeding specs a branch they did not ask for would
 * change what they measure. Callers that need one ask for one.
 *
 * Coordinates are real (Dublin) so radius campaigns resolve — `(0,0)` is
 * rejected on purpose as a bad geocode.
 */
export async function seedLocation(input: {
  organizationId: string;
  name?: string;
  isPrimary?: boolean;
  latitude?: number | null;
  longitude?: number | null;
}): Promise<string> {
  const id = `loc_${randomUUID()}`;
  await db.insert(organizationLocation).values({
    id,
    organizationId: input.organizationId,
    name: input.name ?? 'Main Clinic',
    addressLine1: '1 Test Street',
    city: 'Dublin',
    country: 'ie',
    latitude: input.latitude === undefined ? 53.3498 : input.latitude,
    longitude: input.longitude === undefined ? -6.2603 : input.longitude,
    isPrimary: input.isPrimary ?? true,
  });
  return id;
}

/** Insert an offer scoped to an org. Returns its id. */
export async function seedOffer(input: {
  organizationId: string;
  name?: string;
}): Promise<string> {
  const id = `off_${randomUUID()}`;
  await db.insert(offer).values({
    id,
    organizationId: input.organizationId,
    name: input.name ?? 'Test Offer',
    discountType: 'percentage',
    discountPercent: 10,
  });
  return id;
}

/** Insert a lead scoped to an org. Returns its id. */
export async function seedLead(input: {
  organizationId: string;
  firstName?: string;
}): Promise<string> {
  const id = `lead_${randomUUID()}`;
  await db.insert(lead).values({
    id,
    organizationId: input.organizationId,
    firstName: input.firstName ?? 'Lead',
  });
  return id;
}

/** Insert an organization service scoped to an org. Returns its id. */
export async function seedService(input: {
  organizationId: string;
  name?: string;
}): Promise<string> {
  const id = `svc_${randomUUID()}`;
  await db.insert(organizationService).values({
    id,
    organizationId: input.organizationId,
    name: input.name ?? 'Test Service',
  });
  return id;
}

/**
 * Insert a practitioner scoped to an org, optionally linked to a user. Returns
 * its id. Used by appointment-scoping tests to model "this user is also a
 * practitioner".
 */
export async function seedPractitioner(input: {
  organizationId: string;
  userId?: string;
  name?: string;
  email?: string;
}): Promise<string> {
  const id = `prac_${randomUUID()}`;
  await db.insert(practitioner).values({
    id,
    organizationId: input.organizationId,
    userId: input.userId ?? null,
    name: input.name ?? 'Test Practitioner',
    email: input.email ?? `${id}@example.com`,
  });
  return id;
}

/**
 * Insert a practitioner who can actually be BOOKED: one who is on shift.
 *
 * `seedPractitioner` alone is not enough. Availability is derived solely from
 * `shift` rows, so a practitioner without them has no working time and the
 * public booking endpoints correctly refuse — which is what a real org can
 * never look like, because `createPractitioner` seeds a weekly pattern on
 * create. Tests that book must model the real thing.
 *
 * The pattern is all-day, every day, so a test's chosen slot is never rejected
 * for being outside posted hours.
 */
export async function seedBookablePractitioner(input: {
  organizationId: string;
  userId?: string;
  name?: string;
  email?: string;
}): Promise<string> {
  const practitionerId = await seedPractitioner(input);
  await db.insert(shift).values(
    [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      organizationId: input.organizationId,
      practitionerId,
      locationId: null,
      dayOfWeek,
      date: null,
      startMinutes: 0,
      endMinutes: 24 * 60,
      isOff: false,
    }))
  );
  return practitionerId;
}

/**
 * Insert an appointment scoped to an org. `assignedToId` (→ user.id) and
 * `leadId` (→ lead.id) are NOT NULL; callers must pass a real assignee and we
 * seed a lead automatically unless one is provided.
 */
export async function seedAppointment(input: {
  organizationId: string;
  assignedToId: string;
  leadId?: string;
  practitionerId?: string;
  serviceId?: string;
  title?: string;
  startDate?: Date;
  endDate?: Date;
  /** Defaults to the column default (`booked`). */
  status?: (typeof appointment.$inferInsert)['status'];
  /** Non-null models the SOFT-delete path (`deleteAppointment`). */
  deletedAt?: Date | null;
  /**
   * The branch this appointment happens at. Null = unassigned, which is what
   * every pre-branch row is. Resource re-allocation reads this off the row, so
   * a spec about branch scoping has to set it.
   */
  locationId?: string | null;
}): Promise<string> {
  const id = `appt_${randomUUID()}`;
  const leadId =
    input.leadId ?? (await seedLead({ organizationId: input.organizationId }));
  const start = input.startDate ?? new Date();
  const end = input.endDate ?? new Date(start.getTime() + 30 * 60 * 1000);
  await db.insert(appointment).values({
    id,
    organizationId: input.organizationId,
    assignedToId: input.assignedToId,
    leadId,
    practitionerId: input.practitionerId ?? null,
    serviceId: input.serviceId ?? null,
    title: input.title ?? 'Test Appointment',
    startDate: start,
    endDate: end,
    locationId: input.locationId ?? null,
    ...(input.status ? { status: input.status } : {}),
    ...(input.deletedAt === undefined ? {} : { deletedAt: input.deletedAt }),
  });
  return id;
}

/**
 * Insert a real `timeEntry` row scoped to an org + practitioner. Returns its id.
 *
 * `organizationId`, `practitionerId`, and `clockIn` are NOT NULL; `clockIn`
 * defaults to one hour ago so the row sits in the past. `status` defaults to
 * `completed` when a `clockOut` is supplied, else `open`. A partial unique index
 * (`uq_time_entry_open_per_practitioner`) allows at most ONE open entry per
 * practitioner, so seed at most one open entry per practitioner (or pass a
 * `clockOut`).
 */
export async function seedTimeEntry(input: {
  organizationId: string;
  practitionerId: string;
  clockIn?: Date;
  clockOut?: Date;
  status?: (typeof timeEntry.$inferInsert)['status'];
  source?: (typeof timeEntry.$inferInsert)['source'];
}): Promise<string> {
  const id = `te_${randomUUID()}`;
  const clockIn = input.clockIn ?? new Date(Date.now() - 60 * 60 * 1000);
  await db.insert(timeEntry).values({
    id,
    organizationId: input.organizationId,
    practitionerId: input.practitionerId,
    clockIn,
    clockOut: input.clockOut ?? null,
    status: input.status ?? (input.clockOut ? 'completed' : 'open'),
    source: input.source ?? 'manual',
  });
  return id;
}

/**
 * Give an org a configured Meta Ads integration, so `getMetaCredentials`
 * resolves and the ads/campaign services actually reach Graph.
 *
 * Two rows, because the resolver needs both: the integration carries the
 * encrypted token and the ad account, and `defaultPage` carries the page id —
 * `getMetaCredentials` refuses when either is missing.
 *
 * The token is encrypted with `INTEGRATION_ENCRYPTION_KEY` (`.env.integration`)
 * because the resolver decrypts it. The value never reaches anything real: the
 * Meta contract fake answers every Graph call.
 */
export async function seedMetaAdsIntegration(input: {
  organizationId: string;
  userId: string;
  adAccountId?: string;
  pageId?: string;
}): Promise<{ integrationId: string; adAccountId: string; pageId: string }> {
  const adAccountId = input.adAccountId ?? `act_${randomUUID().slice(0, 12)}`;
  const pageId = input.pageId ?? `page_${randomUUID().slice(0, 12)}`;
  const integrationId = `mai_${randomUUID()}`;
  const pageRowId = `map_${randomUUID()}`;

  await db.insert(metaAdsIntegration).values({
    id: integrationId,
    organizationId: input.organizationId,
    connectedById: input.userId,
    configurationStatus: 'configured',
    adAccountId,
    isActive: true,
    encryptedCredentials: encryptCredentials({
      accessToken: 'integration-fixture-token',
    }),
  });

  await db.insert(metaAdsPage).values({
    id: pageRowId,
    metaAdsIntegrationId: integrationId,
    pageId,
    pageName: 'Integration Test Page',
    platform: 'facebook',
    defaultAdAccountId: adAccountId,
    defaultAdAccountCurrency: 'EUR',
    isActive: true,
  });

  await db
    .update(metaAdsIntegration)
    .set({ defaultPageId: pageRowId })
    .where(eq(metaAdsIntegration.id, integrationId));

  return { integrationId, adAccountId, pageId };
}

export { APP_GUARD };
