import { sendEmail } from '@borradh-workspace/email';
import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
// Stubbed with a restored spy (the mock-boundaries gate forbids vi.mock of
// internal modules): this suite tests submission creation + the email, not
// magic-link minting.
import * as mintMagicLinkModule from '../../../patient-auth/services/mint-magic-link/index.js';
import { ErrorCodes, err, ok } from '../../../shared/index.js';
import { FeatureError } from '../../../shared/index.js';
import { createSubmissionsForAppointment } from './create-submissions-for-appointment.service.js';

describe('createSubmissionsForAppointment', () => {
  const mockDb = createMockDatabase();

  const validInput = {
    appointmentId: 'apt_1',
    leadId: 'lead_1',
    organizationId: 'org_1',
    serviceId: 'svc_1',
  };

  const mockTemplate = {
    id: 'tpl_1',
    organizationId: 'org_1',
    title: 'Laser Consent',
    body: 'I consent.',
    fields: [{ type: 'text', label: 'Allergies' }],
    requiresSignature: true,
    isActive: true,
  };

  const mockLead = {
    id: 'lead_1',
    firstName: 'Jane',
    email: 'jane@example.com',
  };
  const mockOrg = { id: 'org_1', name: 'Glow Clinic', slug: 'glow-clinic' };

  let mintSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mintSpy = vi.spyOn(mintMagicLinkModule, 'mintMagicLink').mockResolvedValue(
      ok({
        token: 'tok_magic_123',
        expiresAt: new Date('2026-08-18T00:00:00Z'),
        organizationSlug: 'glow-clinic',
      })
    );
  });

  afterEach(() => {
    mintSpy.mockRestore();
  });

  it('skips silently (ok) when the service has no requirements', async () => {
    mockDb.query.organizationServiceFormRequirement.findMany.mockResolvedValueOnce(
      []
    );

    const result = await createSubmissionsForAppointment(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 0, submissionIds: [] });
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('skips when every required template is inactive', async () => {
    mockDb.query.organizationServiceFormRequirement.findMany.mockResolvedValueOnce(
      [{ id: 'req_1', serviceId: 'svc_1', templateId: 'tpl_1' }]
    );
    mockDb.query.consentFormTemplate.findMany.mockResolvedValueOnce([]);

    const result = await createSubmissionsForAppointment(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.created).toBe(0);
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('creates one submission per active template with a frozen snapshot and sends ONE email', async () => {
    mockDb.query.organizationServiceFormRequirement.findMany.mockResolvedValueOnce(
      [
        { id: 'req_1', serviceId: 'svc_1', templateId: 'tpl_1' },
        { id: 'req_2', serviceId: 'svc_1', templateId: 'tpl_2' },
      ]
    );
    const secondTemplate = {
      ...mockTemplate,
      id: 'tpl_2',
      title: 'Medical History',
      requiresSignature: false,
    };
    mockDb.query.consentFormTemplate.findMany.mockResolvedValueOnce([
      mockTemplate,
      secondTemplate,
    ]);
    // Rows come back with their frozen snapshot — the email titles are read
    // from these (the rows actually CREATED), not from the template list.
    mockDb.returning.mockResolvedValueOnce([
      { id: 'sub_1', templateSnapshot: { title: 'Laser Consent' } },
      { id: 'sub_2', templateSnapshot: { title: 'Medical History' } },
    ]);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDb.query.organization.findFirst.mockResolvedValueOnce(mockOrg);

    const result = await createSubmissionsForAppointment(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        created: 2,
        submissionIds: ['sub_1', 'sub_2'],
      });
    }

    const [values] = mockDb.values.mock.calls[0];
    expect(values).toHaveLength(2);
    expect(values[0]).toMatchObject({
      organizationId: 'org_1',
      appointmentId: 'apt_1',
      leadId: 'lead_1',
      templateId: 'tpl_1',
      templateSnapshot: {
        title: 'Laser Consent',
        body: 'I consent.',
        fields: [{ type: 'text', label: 'Allergies' }],
        requiresSignature: true,
      },
      sentAt: expect.any(Date),
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jane@example.com',
        props: expect.objectContaining({
          patientName: 'Jane',
          clinicName: 'Glow Clinic',
          formTitles: ['Laser Consent', 'Medical History'],
          pendingFormCount: 2,
          // One-tap magic sign-in link ("Open portal →"), not the bare home.
          portalUrl:
            'https://mock-marketing.example.com/sites/glow-clinic/portal/access?token=tok_magic_123',
        }),
      })
    );
  });

  it("puts the portal link on the clinic's own host once their domain is live", async () => {
    mockDb.query.organizationServiceFormRequirement.findMany.mockResolvedValueOnce(
      [{ id: 'req_1', serviceId: 'svc_1', templateId: 'tpl_1' }]
    );
    mockDb.query.consentFormTemplate.findMany.mockResolvedValueOnce([
      mockTemplate,
    ]);
    mockDb.returning.mockResolvedValueOnce([
      { id: 'sub_1', templateSnapshot: { title: 'Laser Consent' } },
    ]);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDb.query.organization.findFirst.mockResolvedValueOnce(mockOrg);
    mockDb.query.micrositeDomain.findFirst.mockResolvedValueOnce({
      domain: 'glowclinic.ie',
    });

    const result = await createSubmissionsForAppointment(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({
          // Their brand, not ours — and no /sites/{slug} segment, which does
          // not exist on their host.
          portalUrl: 'https://glowclinic.ie/portal/access?token=tok_magic_123',
        }),
      })
    );
  });

  it('falls back to the portal home URL when the magic link cannot be minted', async () => {
    mintSpy.mockResolvedValueOnce(
      err(new FeatureError(ErrorCodes.INTERNAL_ERROR, 'mint failed'))
    );
    mockDb.query.organizationServiceFormRequirement.findMany.mockResolvedValueOnce(
      [{ id: 'req_1', serviceId: 'svc_1', templateId: 'tpl_1' }]
    );
    mockDb.query.consentFormTemplate.findMany.mockResolvedValueOnce([
      mockTemplate,
    ]);
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'sub_1',
        templateSnapshot: { title: 'Laser Consent' },
      },
    ]);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDb.query.organization.findFirst.mockResolvedValueOnce(mockOrg);

    const result = await createSubmissionsForAppointment(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({
          pendingFormCount: 1,
          portalUrl:
            'https://mock-marketing.example.com/sites/glow-clinic/portal',
        }),
      })
    );
  });

  it('still creates submissions when the lead has no email (no send)', async () => {
    mockDb.query.organizationServiceFormRequirement.findMany.mockResolvedValueOnce(
      [{ id: 'req_1', serviceId: 'svc_1', templateId: 'tpl_1' }]
    );
    mockDb.query.consentFormTemplate.findMany.mockResolvedValueOnce([
      mockTemplate,
    ]);
    mockDb.returning.mockResolvedValueOnce([
      { id: 'sub_1', templateSnapshot: { title: 'Laser Consent' } },
    ]);
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      ...mockLead,
      email: null,
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce(mockOrg);

    const result = await createSubmissionsForAppointment(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.created).toBe(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('is idempotent — a re-run that creates nothing sends no second email', async () => {
    mockDb.query.organizationServiceFormRequirement.findMany.mockResolvedValueOnce(
      [{ id: 'req_1', serviceId: 'svc_1', templateId: 'tpl_1' }]
    );
    mockDb.query.consentFormTemplate.findMany.mockResolvedValueOnce([
      mockTemplate,
    ]);
    // onConflictDoNothing swallowed the insert — the submission already exists
    // for this (appointment, template), so RETURNING yields nothing.
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await createSubmissionsForAppointment(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ created: 0, submissionIds: [] });
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('emails only about the forms it actually created', async () => {
    mockDb.query.organizationServiceFormRequirement.findMany.mockResolvedValueOnce(
      [
        { id: 'req_1', serviceId: 'svc_1', templateId: 'tpl_1' },
        { id: 'req_2', serviceId: 'svc_1', templateId: 'tpl_2' },
      ]
    );
    mockDb.query.consentFormTemplate.findMany.mockResolvedValueOnce([
      mockTemplate,
      { ...mockTemplate, id: 'tpl_2', title: 'Medical History' },
    ]);
    // Only the second is new — the first was already sent on an earlier run.
    mockDb.returning.mockResolvedValueOnce([
      { id: 'sub_2', templateSnapshot: { title: 'Medical History' } },
    ]);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDb.query.organization.findFirst.mockResolvedValueOnce(mockOrg);

    const result = await createSubmissionsForAppointment(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.created).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({
          // NOT 'Laser Consent' — the patient was already asked for that one.
          formTitles: ['Medical History'],
        }),
      })
    );
  });

  it('returns VALIDATION_ERROR for a missing appointmentId', async () => {
    await expectResult(
      createSubmissionsForAppointment(mockDb as never, {
        ...validInput,
        appointmentId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on database failure', async () => {
    mockDb.query.organizationServiceFormRequirement.findMany.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      createSubmissionsForAppointment(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
