import { sendEmail } from '@borradh-workspace/email';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

import { notifyOwnerCancellation } from './notify-owner-cancellation.service.js';

const mockSendEmail = vi.mocked(sendEmail);

describe('notifyOwnerCancellation', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    appointmentId: 'appt_123',
    organizationId: 'org_123',
    cancellationReason: 'Feeling unwell',
  };

  const owner = {
    userId: 'user_owner',
    role: 'owner',
    user: { id: 'user_owner', name: 'Jane Owner', email: 'jane@salon.com' },
  };

  it('emails the owner with the cancelled appointment + reason', async () => {
    mockDb.query.member.findFirst.mockResolvedValueOnce(owner);
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_123',
      practitionerId: null,
      leadId: 'lead_1',
      title: 'Botox: John Doe',
      startDate: new Date('2026-06-15T10:00:00Z'),
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead_1',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      phone: '+353851234567',
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      name: 'Glow Clinic',
    });
    mockSendEmail.mockResolvedValueOnce(undefined);

    const result = await notifyOwnerCancellation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jane@salon.com',
        props: expect.objectContaining({
          clientName: 'John Doe',
          cancellationReason: 'Feeling unwell',
          organizationName: 'Glow Clinic',
        }),
      })
    );
  });

  it('returns sent:false when there is no owner', async () => {
    mockDb.query.member.findFirst.mockResolvedValueOnce(null);

    const result = await notifyOwnerCancellation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sent).toBe(false);
      expect(result.data.reason).toContain('No owner');
    }
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('skips when the owner is also the assigned practitioner', async () => {
    mockDb.query.member.findFirst.mockResolvedValueOnce(owner);
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_123',
      practitionerId: 'prac_1',
      leadId: 'lead_1',
      title: 'Botox',
      startDate: new Date('2026-06-15T10:00:00Z'),
    });
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      email: 'jane@salon.com',
    });

    const result = await notifyOwnerCancellation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sent).toBe(false);
      expect(result.data.reason).toContain('already notified');
    }
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns sent:false when the appointment is gone', async () => {
    mockDb.query.member.findFirst.mockResolvedValueOnce(owner);
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);

    const result = await notifyOwnerCancellation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(false);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns sent:false when the email send fails', async () => {
    mockDb.query.member.findFirst.mockResolvedValueOnce(owner);
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_123',
      practitionerId: null,
      leadId: null,
      title: 'Botox',
      startDate: new Date(),
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      name: 'Glow Clinic',
    });
    mockSendEmail.mockRejectedValueOnce(new Error('Email failed'));

    const result = await notifyOwnerCancellation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(false);
  });

  it('returns VALIDATION_ERROR for a missing appointmentId', async () => {
    await expectResult(
      notifyOwnerCancellation(mockDb as never, {
        ...validInput,
        appointmentId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
