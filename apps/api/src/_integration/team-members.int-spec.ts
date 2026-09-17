import { randomUUID } from 'node:crypto';
import {
  db,
  invitation,
  member,
  organizationLocation,
  practitioner,
  practitionerWageConfig,
} from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
/**
 * Fresha domain — Add-team-member (asserted over HTTP against a real DB).
 *
 * Exercises the four "Add team member" API surfaces end to end through the real
 * Nest HTTP pipeline + real feature services + real SQL, with only the AuthGuard
 * faked (identity stamped by the harness). RoleGuard is registered by the
 * harness as a provider, so @RequireRole('admin') on the composite create bites
 * against the seeded `member` rows.
 *
 *   1. COMPOSITE CREATE — an admin POSTs /practitioners/team-member with
 *      services + locations + a wage patch + permissionLevel `medium`. One
 *      transaction creates the practitioner (new profile columns), the wage
 *      config (incl. `locationRestriction`), and the invitation (prefill fields
 *      + role derived from the permission level: medium → admin).
 *   2. ADMIN BOUNDARY — a plain member is FORBIDDEN from the composite create.
 *   3. PUBLIC TOKEN LOOKUP — GET /organizations/invitations/token/:token
 *      (public, token = invitation id) returns org name, inviter name and the
 *      prefill fields; a bad token → 404; the response leaks NOTHING beyond the
 *      documented projection (exact key-set assertion).
 *   4. ACCEPT — POST /organizations/invitations/:id/accept { acceptedTerms:true }
 *      creates a member with the invitation's role, stamps `termsAcceptedAt`,
 *      auto-links the practitioner, and copies the prefill (lowercase country
 *      `ie`) onto it.
 *   5. WAGE CONFIG — PUT /wage-configs/:practitionerId persists + returns the
 *      `locationRestriction`.
 *   6. CROSS-ORG ISOLATION — an org-B caller cannot read an org-A practitioner
 *      (404), and the composite create is server-scoped to the caller's active
 *      org (never org A).
 *
 * Country enum values are LOWERCASE ISO (`ie`); `phoneCountry` is free text.
 */
import { OrganizationsController } from '../organizations/organizations.controller.js';
import { PractitionersController } from '../practitioners/practitioners.controller.js';
import { WageConfigsController } from '../wage-configs/wage-configs.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
  seedPractitioner,
  seedService,
  seedUser,
} from './harness.js';

const FORBIDDEN = 403;
const NOT_FOUND = 404;

/** Unique suffix per run so nothing collides across re-runs. */
const uid = () => `${Date.now()}-${randomUUID().slice(0, 8)}`;

/** Insert a real `organization_location` row (NOT NULL: address1/city/country). */
async function seedLocation(input: {
  organizationId: string;
  isPrimary?: boolean;
}): Promise<string> {
  const id = `loc_${randomUUID()}`;
  await db.insert(organizationLocation).values({
    id,
    organizationId: input.organizationId,
    name: 'Main Clinic',
    addressLine1: '1 Test Street',
    city: 'Dublin',
    country: 'ie',
    isPrimary: input.isPrimary ?? true,
  });
  return id;
}

/** Insert a real pending `invitation` row (token === id). */
async function seedInvitation(input: {
  organizationId: string;
  inviterId: string;
  email: string;
  role?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  phoneCountry?: string;
  country?: string;
  status?: string;
  expiresAt?: Date;
}): Promise<string> {
  const id = `inv_${randomUUID()}`;
  await db.insert(invitation).values({
    id,
    organizationId: input.organizationId,
    inviterId: input.inviterId,
    email: input.email,
    role: input.role ?? 'admin',
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    phone: input.phone ?? null,
    phoneCountry: input.phoneCountry ?? null,
    country: input.country ?? null,
    status: input.status ?? 'pending',
    expiresAt:
      input.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  return id;
}

describe('Fresha domain — add team member (HTTP)', () => {
  describe('composite create (admin)', () => {
    it('creates practitioner + wage config + invitation atomically', async () => {
      const admin = await seedOrgWithMember('admin');
      const orgId = admin.organizationId;
      const serviceId = await seedService({ organizationId: orgId });
      const locationId = await seedLocation({ organizationId: orgId });
      const email = `member-${uid()}@example.com`;

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(PractitionersController, {
          userId: admin.userId,
          organizationId: orgId,
        });
        const server = h.app.getHttpServer();

        const res = await request(server)
          .post('/practitioners/team-member')
          .send({
            firstName: 'Aoife',
            lastName: 'Byrne',
            email,
            phone: '+353871234567',
            phoneCountry: 'IE',
            country: 'ie',
            jobTitle: 'Senior Stylist',
            employmentType: 'full_time',
            notes: 'Great with colour work',
            permissionLevel: 'medium',
            serviceIds: [serviceId],
            locationIds: [locationId],
            wageConfig: {
              compensationType: 'hourly',
              hourlyRateCents: 2500,
              locationRestriction: 'enabled',
            },
          });

        expect([200, 201]).toContain(res.status);

        // --- practitioner: new profile columns persisted ------------------
        const prac = res.body.practitioner;
        expect(prac).toBeTruthy();
        expect(prac.organizationId).toBe(orgId);
        expect(prac.firstName).toBe('Aoife');
        expect(prac.lastName).toBe('Byrne');
        expect(prac.email).toBe(email);
        expect(prac.country).toBe('ie');
        expect(prac.title).toBe('Senior Stylist'); // jobTitle → title
        expect(prac.employmentType).toBe('full_time');

        // --- invitation: prefill fields + medium → admin role -------------
        const invite = res.body.invitation;
        expect(invite).toBeTruthy();
        expect(invite.email).toBe(email);
        expect(invite.role).toBe('admin');
        expect(invite.firstName).toBe('Aoife');
        expect(invite.lastName).toBe('Byrne');
        expect(invite.country).toBe('ie');
        expect(invite.status).toBeTruthy();

        // The invitation row really exists and carries the prefill.
        const invRow = await db.query.invitation.findFirst({
          where: eq(invitation.id, invite.id),
        });
        expect(invRow?.role).toBe('admin');
        expect(invRow?.firstName).toBe('Aoife');

        // --- wage config: values incl. locationRestriction ----------------
        // (Read from the DB directly — /wage-configs is a different controller,
        // and this app hosts only PractitionersController.)
        const wageRow = await db.query.practitionerWageConfig.findFirst({
          where: eq(practitionerWageConfig.practitionerId, prac.id),
        });
        expect(wageRow).toBeTruthy();
        expect(wageRow?.hourlyRateCents).toBe(2500);
        expect(wageRow?.locationRestriction).toBe('enabled');
      } finally {
        await h?.close();
      }
    });
  });

  describe('admin boundary', () => {
    it('a plain member cannot create a team member → 403', async () => {
      const plain = await seedOrgWithMember('member');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(PractitionersController, {
          userId: plain.userId,
          organizationId: plain.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/practitioners/team-member')
          .send({
            firstName: 'Nope',
            email: `nope-${uid()}@example.com`,
            permissionLevel: 'low',
          });
        expect(res.status).toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });
  });

  describe('public token lookup', () => {
    it('returns the invite with org + inviter + prefill and leaks nothing extra', async () => {
      // Inviter carries a name so `inviterName` is populated.
      const owner = await seedOrgWithMember('owner');
      const invitedEmail = `invited-${uid()}@example.com`;
      const token = await seedInvitation({
        organizationId: owner.organizationId,
        inviterId: owner.userId,
        email: invitedEmail,
        role: 'admin',
        firstName: 'Ciara',
        lastName: 'Nolan',
        phone: '+353870000000',
        phoneCountry: 'IE',
        country: 'ie',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const res = await request(server).get(
          `/organizations/invitations/token/${token}`
        );
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(token);
        expect(res.body.email).toBe(invitedEmail);
        expect(res.body.role).toBe('admin');
        expect(res.body.organizationName).toBeTruthy();
        expect(res.body.inviterName).toBeTruthy();
        expect(res.body.effectiveStatus).toBe('pending');
        // Prefill fields exposed for the Review-and-confirm step.
        expect(res.body.firstName).toBe('Ciara');
        expect(res.body.lastName).toBe('Nolan');
        expect(res.body.phone).toBe('+353870000000');
        expect(res.body.country).toBe('ie');

        // Leaks NOTHING beyond the documented projection.
        expect(Object.keys(res.body).sort()).toEqual(
          [
            'country',
            'effectiveStatus',
            'email',
            'expiresAt',
            'firstName',
            'id',
            'inviterName',
            'isExpired',
            'lastName',
            'organizationId',
            'organizationName',
            'phone',
            'phoneCountry',
            'role',
            'status',
          ].sort()
        );

        // Bad token → 404.
        const bad = await request(server).get(
          '/organizations/invitations/token/does-not-exist'
        );
        expect(bad.status).toBe(NOT_FOUND);
      } finally {
        await h?.close();
      }
    });
  });

  describe('accept invitation', () => {
    it('creates the member with the invite role, stamps terms, links + prefills the practitioner', async () => {
      const owner = await seedOrgWithMember('owner');
      const orgId = owner.organizationId;
      const invitedEmail = `accept-${uid()}@example.com`;

      // A practitioner exists (unlinked) with the invited email — the accept
      // flow auto-links it by email and copies the prefill onto it.
      const practitionerId = await seedPractitioner({
        organizationId: orgId,
        email: invitedEmail,
      });
      // The invited person's user account (email must match the invitation).
      const invitedUser = await seedUser({ email: invitedEmail });
      const token = await seedInvitation({
        organizationId: orgId,
        inviterId: owner.userId,
        email: invitedEmail,
        role: 'admin',
        firstName: 'Saoirse',
        country: 'ie',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationsController, {
          userId: invitedUser.id,
          organizationId: undefined,
          email: invitedEmail,
        });

        const res = await request(h.app.getHttpServer())
          .post(`/organizations/invitations/${token}/accept`)
          .send({ acceptedTerms: true });
        expect([200, 201]).toContain(res.status);
        expect(res.body.organizationId).toBe(orgId);
        expect(res.body.userId).toBe(invitedUser.id);
        expect(res.body.role).toBe('admin'); // from invitation.role
        expect(res.body.practitionerId).toBe(practitionerId); // auto-linked

        // member row: role + termsAcceptedAt stamped.
        const memberRow = await db.query.member.findFirst({
          where: and(
            eq(member.organizationId, orgId),
            eq(member.userId, invitedUser.id)
          ),
        });
        expect(memberRow?.role).toBe('admin');
        expect(memberRow?.termsAcceptedAt).toBeTruthy();

        // practitioner: linked to the user + prefill copied.
        const pracRow = await db.query.practitioner.findFirst({
          where: eq(practitioner.id, practitionerId),
        });
        expect(pracRow?.userId).toBe(invitedUser.id);
        expect(pracRow?.firstName).toBe('Saoirse');
        expect(pracRow?.country).toBe('ie');
      } finally {
        await h?.close();
      }
    });
  });

  describe('wage config location restriction', () => {
    it('PUT persists and returns locationRestriction', async () => {
      const owner = await seedOrgWithMember('owner');
      const practitionerId = await seedPractitioner({
        organizationId: owner.organizationId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(WageConfigsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const put = await request(server)
          .put(`/wage-configs/${practitionerId}`)
          .send({ locationRestriction: 'enabled' });
        expect(put.status).toBe(200);
        expect(put.body.locationRestriction).toBe('enabled');

        const get = await request(server).get(
          `/wage-configs/${practitionerId}`
        );
        expect(get.status).toBe(200);
        expect(get.body.locationRestriction).toBe('enabled');
      } finally {
        await h?.close();
      }
    });
  });

  describe('cross-org isolation', () => {
    it("org-B cannot read org-A's practitioner; composite create scopes to the caller's org", async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('admin');

      const pracA = await seedPractitioner({
        organizationId: orgA.organizationId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(PractitionersController, {
          userId: orgB.userId,
          organizationId: orgB.organizationId,
        });
        const server = h.app.getHttpServer();

        // org B reading org A's practitioner → 404 (service is org-scoped).
        const read = await request(server).get(`/practitioners/${pracA}`);
        expect(read.status).toBe(NOT_FOUND);

        // The composite create has no org param — it always writes to the
        // caller's active org, never the victim org A.
        const created = await request(server)
          .post('/practitioners/team-member')
          .send({
            firstName: 'Intruder',
            email: `intruder-${uid()}@example.com`,
            permissionLevel: 'low',
          });
        expect([200, 201]).toContain(created.status);
        expect(created.body.practitioner.organizationId).toBe(
          orgB.organizationId
        );
        expect(created.body.practitioner.organizationId).not.toBe(
          orgA.organizationId
        );
      } finally {
        await h?.close();
      }
    });
  });
});
