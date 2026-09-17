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

import { notifyOwnerReschedule } from './notify-owner-reschedule.service.js';

const mockSendEmail = vi.mocked(sendEmail);

describe('notifyOwnerReschedule', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    appointmentId: 'appt_123',
    organizationId: 'org_123',
    oldStartDate: new Date('2026-06-15T10:00:00Z'),
  };

  const owner = {
    userId: 'user_owner',
    role: 'owner',
    user: { id: 'user_owner', name: 'Jane Owner', email: 'jane@salon.com' },
  };

  it('emails the owner with both the old and new times', async () => {
    mockDb.query.member.findFirst.mockResolvedValueOnce(owner);
    // Row holds the NEW time (reschedule already committed).
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_123',
      leadId: 'lead_1',
      title: 'Botox: John Doe',
      startDate: new Date('2026-06-20T14:00:00Z'),
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead_1',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      phone: null,
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      name: 'Glow Clinic',
    });
    mockSendEmail.mockResolvedValueOnce(undefined);

    const result = await notifyOwnerReschedule(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(true);
    const call = mockSendEmail.mock.calls[0]?.[0] as {
      to: string;
      props: { oldFormattedDate: string; newFormattedDate: string };
    };
    expect(call.to).toBe('jane@salon.com');
    // Old time is the 15th, new time is the 20th — distinct, both present.
    expect(call.props.oldFormattedDate).toContain('15');
    expect(call.props.newFormattedDate).toContain('20');
  });

  it('returns sent:false when there is no owner', async () => {
    mockDb.query.member.findFirst.mockResolvedValueOnce(null);

    const result = await notifyOwnerReschedule(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sent).toBe(false);
      expect(result.data.reason).toContain('No owner');
    }
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns sent:false when the appointment is gone', async () => {
    mockDb.query.member.findFirst.mockResolvedValueOnce(owner);
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);

    const result = await notifyOwnerReschedule(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(false);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns sent:false when the email send fails', async () => {
    mockDb.query.member.findFirst.mockResolvedValueOnce(owner);
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_123',
      leadId: null,
      title: 'Botox',
      startDate: new Date('2026-06-20T14:00:00Z'),
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      name: 'Glow Clinic',
    });
    mockSendEmail.mockRejectedValueOnce(new Error('Email failed'));

    const result = await notifyOwnerReschedule(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(false);
  });

  it('returns VALIDATION_ERROR for a missing appointmentId', async () => {
    await expectResult(
      notifyOwnerReschedule(mockDb as never, {
        ...validInput,
        appointmentId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
