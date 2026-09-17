import request from 'supertest';
/**
 * ENG-647 — authorization on the STAFF clinical surfaces, over HTTP, against a
 * real database.
 *
 * WHY THIS EXISTS. Both controllers shipped carrying
 * `@UseGuards(AuthGuard, RoleGuard)` and NO `@RequireRole` on any handler.
 * `RoleGuard` returns true unconditionally when a handler declares no metadata
 * (role.guard.ts), so the guard was authentication only: the lowest-privilege
 * `member` of a clinic could download every patient's signed consent PDF and
 * every uploaded medical document, delete them, and spend model credits via
 * `POST /consent-form-templates/generate`.
 *
 * `role-guard-coverage.spec.ts` closes the CLASS — it fails the build if any
 * handler on a RoleGuard controller lacks metadata. But a source scan proves a
 * decorator EXISTS; it cannot prove the guard is wired, that the role
 * hierarchy resolves the way the docs claim, or that a `member` actually
 * receives a 403. That is what this asserts, through the real Nest pipeline
 * with only AuthGuard faked.
 *
 * Where the line sits (guards/permissions.ts three-tier model):
 *   member — trusted staff, i.e. practitioners. Reads templates, sees who has
 *            signed, opens a signed PDF, and handles a patient's documents:
 *            day-to-day clinical work.
 *   admin  — authoring and configuration: creating/editing/deleting templates,
 *            choosing which services require them, spending model credits, and
 *            DELETING a patient document (the one irreversible action, which
 *            also changes what the patient sees in their portal).
 */
import { ConsentFormTemplatesController } from '../consent-forms/consent-form-templates.controller.js';
import { StaffPatientDocumentsController } from '../patient-documents/staff-patient-documents.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedLead,
  seedOrgWithMember,
} from './harness.js';

describe('ENG-647 staff clinical surfaces — role enforcement', () => {
  let templates: IntegrationApp;
  let documents: IntegrationApp;

  let organizationId: string;
  let leadId: string;
  let memberIdentity: { userId: string; organizationId: string };
  let adminIdentity: { userId: string; organizationId: string };
  let ownerIdentity: { userId: string; organizationId: string };

  beforeAll(async () => {
    const owner = await seedOrgWithMember('owner');
    organizationId = owner.organizationId;
    ownerIdentity = { userId: owner.userId, organizationId };

    const admin = await seedOrgWithMember('admin', { organizationId });
    adminIdentity = { userId: admin.userId, organizationId };

    const member = await seedOrgWithMember('member', { organizationId });
    memberIdentity = { userId: member.userId, organizationId };

    leadId = await seedLead({ organizationId });

    templates = await buildControllerApp(
      ConsentFormTemplatesController,
      ownerIdentity
    );
    documents = await buildControllerApp(
      StaffPatientDocumentsController,
      ownerIdentity
    );
  });

  afterAll(async () => {
    await templates?.app.close();
    await documents?.app.close();
  });

  /**
   * The routes that AUTHOR or CONFIGURE, plus the one destructive document
   * action. A `member` must be refused; an `admin` must not be.
   */
  describe('admin-only routes refuse a member', () => {
    const adminRoutes: Array<[string, 'post' | 'put' | 'delete', string]> = [
      ['create a template', 'post', '/consent-form-templates'],
      ['edit a template', 'put', '/consent-form-templates/tpl_missing'],
      ['delete a template', 'delete', '/consent-form-templates/tpl_missing'],
      ['draft one with AI', 'post', '/consent-form-templates/generate'],
      [
        'set which services require consent',
        'put',
        '/consent-form-templates/organization-services-form-requirements/svc_missing',
      ],
    ];

    it.each(adminRoutes)(
      '403s a member trying to %s',
      async (_l, verb, url) => {
        templates.actAs(memberIdentity);

        const res = await request(templates.app.getHttpServer())
          [verb](url)
          .send({});

        expect(res.status).toBe(403);
      }
    );

    it('403s a member deleting a patient document', async () => {
      documents.actAs(memberIdentity);

      const res = await request(documents.app.getHttpServer()).delete(
        `/leads/${leadId}/documents/doc_missing`
      );

      expect(res.status).toBe(403);
    });

    it('does NOT 403 an admin on the same routes', async () => {
      templates.actAs(adminIdentity);

      const res = await request(templates.app.getHttpServer())
        .delete('/consent-form-templates/tpl_missing')
        .send({});

      // 404 (no such template) is the point: authorization passed and the
      // request reached the service. Anything but 403.
      expect(res.status).not.toBe(403);
    });
  });

  /**
   * The clinical READS. A practitioner opening a patient's signed form is
   * day-to-day work — gating it above `member` would push clinics onto shared
   * owner logins, which is worse than the thing it protects against.
   */
  describe('member-level routes admit a member', () => {
    const memberRoutes: Array<[string, string]> = [
      ['list templates', '/consent-form-templates'],
      ['list submissions', '/consent-form-templates/submissions'],
    ];

    it.each(memberRoutes)('admits a member to %s', async (_label, url) => {
      templates.actAs(memberIdentity);

      const res = await request(templates.app.getHttpServer()).get(url);

      expect(res.status).not.toBe(403);
      expect(res.status).toBeLessThan(500);
    });

    it("admits a member to a patient's document list", async () => {
      documents.actAs(memberIdentity);

      const res = await request(documents.app.getHttpServer()).get(
        `/leads/${leadId}/documents`
      );

      expect(res.status).not.toBe(403);
      expect(res.status).toBeLessThan(500);
    });
  });

  /**
   * Every route on both controllers must reject a caller who is not a member
   * of the org at all — the guard resolves membership from
   * `activeOrganizationId`, so an identity with none has no business here.
   */
  it('refuses a caller with no organization context', async () => {
    templates.actAs({
      userId: memberIdentity.userId,
      organizationId: undefined,
    });

    const res = await request(templates.app.getHttpServer()).get(
      '/consent-form-templates'
    );

    expect(res.status).toBe(403);
  });

  /**
   * A member of ANOTHER clinic is not a member of this one. Distinct from the
   * case above: the identity is well-formed, it simply belongs elsewhere.
   */
  it('refuses a member of a different organization', async () => {
    const otherOrg = await seedOrgWithMember('admin');
    templates.actAs({
      userId: otherOrg.userId,
      organizationId,
    });

    const res = await request(templates.app.getHttpServer())
      .post('/consent-form-templates')
      .send({ title: 'x', body: 'y' });

    expect(res.status).toBe(403);
  });
});
