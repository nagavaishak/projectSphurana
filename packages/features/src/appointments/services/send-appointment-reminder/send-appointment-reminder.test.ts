import { sendEmail } from '@borradh-workspace/email';
import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Stubbed with a restored spy (the mock-boundaries gate forbids vi.mock of
// internal modules): these tests cover the reminder + form-count line, not
// magic-link minting.
import * as mintMagicLinkModule from '../../../patient-auth/services/mint-magic-link/index.js';
import { ok } from '../../../shared/index.js';
import { sendAppointmentReminder } from './send-appointment-reminder.service.js';

const mockSendEmail = vi.mocked(sendEmail);

describe('sendAppointmentReminder', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockSendEmail.mockResolvedValue({ messageId: 'msg_1' });
    // Pending-consent-form count is a COUNT(*) via
    // db.select({ value: count() }).from(consentFormSubmission).where(...).
    // Default it to 0 (no forms → no magic link minted); a test that wants the
    // form-count line overrides this.
    mockDb.from.mockReturnValue({
      where: vi.fn().mockResolvedValue([{ value: 0 }]),
    } as never);
  });

  const claimed = {
    id: 'appt_1',
    title: 'Consultation',
    startDate: new Date('2026-08-01T10:00:00Z'),
    leadId: 'lead_1',
    organizationId: 'org_1',
  };

  const lead = {
    id: 'lead_1',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
  };

  it('sends the reminder when the claim is won', async () => {
    // claim UPDATE … RETURNING wins
    mockDb.returning.mockResolvedValueOnce([claimed]);
    mockDb.query.lead.findFirst.mockResolvedValue(lead);
    mockDb.query.organization.findFirst.mockResolvedValue({ name: 'Org' });

    const result = await sendAppointmentReminder(mockDb as never, {
      appointmentId: 'appt_1',
      kind: '24h',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it('includes the pending-form count and a minted portal link when forms are unsigned', async () => {
    const mintSpy = vi
      .spyOn(mintMagicLinkModule, 'mintMagicLink')
      .mockResolvedValue(
        ok({
          token: 'tok_magic_abc',
          expiresAt: new Date('2026-08-18T00:00:00Z'),
          organizationSlug: 'glow-clinic',
        })
      );

    mockDb.returning.mockResolvedValueOnce([claimed]);
    mockDb.query.lead.findFirst.mockResolvedValue(lead);
    mockDb.query.organization.findFirst.mockResolvedValue({
      name: 'Org',
      slug: 'glow-clinic',
    });
    // Two forms still pending for this appointment.
    mockDb.from.mockReturnValue({
      where: vi.fn().mockResolvedValue([{ value: 2 }]),
    } as never);

    const result = await sendAppointmentReminder(mockDb as never, {
      appointmentId: 'appt_1',
      kind: '24h',
    });

    expect(result.success).toBe(true);
    expect(mintSpy).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({
          pendingFormCount: 2,
          portalUrl:
            'https://mock-marketing.example.com/sites/glow-clinic/portal/access?token=tok_magic_abc',
        }),
      })
    );

    mintSpy.mockRestore();
  });

  it("mints the portal link on the clinic's own host once their domain is live", async () => {
    const mintSpy = vi
      .spyOn(mintMagicLinkModule, 'mintMagicLink')
      .mockResolvedValue(
        ok({
          token: 'tok_magic_abc',
          expiresAt: new Date('2026-08-18T00:00:00Z'),
          organizationSlug: 'glow-clinic',
        })
      );

    mockDb.returning.mockResolvedValueOnce([claimed]);
    mockDb.query.lead.findFirst.mockResolvedValue(lead);
    mockDb.query.organization.findFirst.mockResolvedValue({
      name: 'Org',
      slug: 'glow-clinic',
    });
    mockDb.query.micrositeDomain.findFirst.mockResolvedValueOnce({
      domain: 'glowclinic.ie',
    });
    mockDb.from.mockReturnValue({
      where: vi.fn().mockResolvedValue([{ value: 2 }]),
    } as never);

    const result = await sendAppointmentReminder(mockDb as never, {
      appointmentId: 'appt_1',
      kind: '24h',
    });

    expect(result.success).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({
          portalUrl: 'https://glowclinic.ie/portal/access?token=tok_magic_abc',
        }),
      })
    );

    mintSpy.mockRestore();
  });

  /**
   * BRANCH ADDRESS (phase 3c). The reminder tells the patient where to go, and
   * an org with two branches has two answers. The pipeline used to select
   * neither — the claim returned no `locationId` and no branch was ever read —
   * so the email named a time and no place.
   *
   * The NULL case is the one that matters: `getBookingLocationById` has no
   * default-branch fallback, so a pre-backfill row sends NO address rather than
   * the primary branch's. Cork patient, Dublin address is the failure mode.
   */
  it('names the branch the appointment is actually at', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { ...claimed, locationId: 'loc_cork' },
    ]);
    mockDb.query.lead.findFirst.mockResolvedValue(lead);
    mockDb.query.organization.findFirst.mockResolvedValue({ name: 'Org' });
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      id: 'loc_cork',
      slug: 'cork',
      addressLine1: 'Unit 4',
      addressLine2: null,
      city: 'Cork',
      county: null,
      postalCode: 'T12 XY45',
    });

    const result = await sendAppointmentReminder(mockDb as never, {
      appointmentId: 'appt_1',
      kind: '24h',
    });

    expect(result.success).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({
          organizationAddress: 'Unit 4, Cork, T12 XY45',
        }),
      })
    );
  });

  it("sends NO address (never another branch's) when the appointment has no branch", async () => {
    // A pre-backfill row: location_id IS NULL.
    mockDb.returning.mockResolvedValueOnce([{ ...claimed, locationId: null }]);
    mockDb.query.lead.findFirst.mockResolvedValue(lead);
    mockDb.query.organization.findFirst.mockResolvedValue({ name: 'Org' });

    const result = await sendAppointmentReminder(mockDb as never, {
      appointmentId: 'appt_1',
      kind: '24h',
    });

    expect(result.success).toBe(true);
    // Not queried at all — there is nothing to resolve, and resolving anyway is
    // how the default branch would leak in.
    expect(mockDb.query.organizationLocation.findFirst).not.toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({ organizationAddress: undefined }),
      })
    );
  });

  it('no-ops when the claim returns nothing (already sent / cancelled)', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await sendAppointmentReminder(mockDb as never, {
      appointmentId: 'appt_1',
      kind: '1h',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(false);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('no-ops (keeps claim) when the lead has no email', async () => {
    mockDb.returning.mockResolvedValueOnce([claimed]);
    mockDb.query.lead.findFirst.mockResolvedValue({ ...lead, email: null });

    const result = await sendAppointmentReminder(mockDb as never, {
      appointmentId: 'appt_1',
      kind: '24h',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(false);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('releases the claim and rethrows when the email send fails', async () => {
    mockDb.returning.mockResolvedValueOnce([claimed]);
    mockDb.query.lead.findFirst.mockResolvedValue(lead);
    mockDb.query.organization.findFirst.mockResolvedValue({ name: 'Org' });
    mockSendEmail.mockRejectedValueOnce(new Error('smtp down'));

    await expect(
      sendAppointmentReminder(mockDb as never, {
        appointmentId: 'appt_1',
        kind: '24h',
      })
    ).rejects.toThrow('smtp down');

    // claim UPDATE + reset UPDATE
    expect(mockDb.update).toHaveBeenCalledTimes(2);
  });

  it('returns VALIDATION_ERROR for bad input', async () => {
    const result = await sendAppointmentReminder(mockDb as never, {
      appointmentId: '',
      kind: '24h',
    });
    expect(result.success).toBe(false);
  });
});
