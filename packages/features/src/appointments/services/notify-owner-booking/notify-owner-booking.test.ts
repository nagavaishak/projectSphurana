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

import { notifyOwnerBooking } from './notify-owner-booking.service.js';

const mockSendEmail = vi.mocked(sendEmail);

describe('notifyOwnerBooking', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // The shared `sendEmail` mock is reset to a resolving default globally in
    // test-setup.ts before each test; individual cases queue their own
    // `mockRejectedValueOnce` for the failure paths.
  });

  const validInput = {
    appointmentId: 'appt_123',
    organizationId: 'org_123',
  };

  it('should send booking notification email to owner', async () => {
    mockDb.query.member.findFirst.mockResolvedValueOnce({
      userId: 'user_owner',
      role: 'owner',
      user: { id: 'user_owner', name: 'Jane Owner', email: 'jane@salon.com' },
    });
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_123',
      practitionerId: null,
      leadId: 'lead_1',
      title: 'Haircut: John Doe',
      startDate: new Date('2024-06-15T10:00:00Z'),
      description: 'Notes here',
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead_1',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      phone: '+353851234567',
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      name: 'Test Salon',
    });
    mockSendEmail.mockResolvedValueOnce(undefined);

    const result = await notifyOwnerBooking(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'jane@salon.com' })
    );
  });

  // The gap that let this bug ship three times: every case above asserts an
  // email was SENT, none asserted what TIME it said. A formatter rendering in
  // the server's zone (UTC in production) passes all of them while telling the
  // owner the wrong hour.
  describe('renders the time in the BUSINESS timezone', () => {
    const seed = (timezone?: string) => {
      mockDb.query.member.findFirst.mockResolvedValueOnce({
        userId: 'user_owner',
        role: 'owner',
        user: { id: 'user_owner', name: 'Jane Owner', email: 'jane@salon.com' },
      });
      mockDb.query.appointment.findFirst.mockResolvedValueOnce({
        id: 'appt_123',
        practitionerId: null,
        leadId: 'lead_1',
        title: 'Haircut: John Doe',
        // June, so Dublin is on IST (UTC+1) and Los Angeles on PDT (UTC-7).
        startDate: new Date('2024-06-15T10:00:00Z'),
        description: null,
      });
      mockDb.query.lead.findFirst.mockResolvedValueOnce({
        id: 'lead_1',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        phone: null,
      });
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        name: 'Test Salon',
        timezone,
      });
      mockSendEmail.mockResolvedValueOnce(undefined);
    };

    // Normalise the meridiem before asserting. ICU renders `en-IE` as
    // "11:00 a.m." on some versions and "11:00 am" on others (Node 22 / ICU 77
    // locally vs the CI runner), so pinning the exact string makes the test
    // depend on the environment rather than on the behaviour. The ZONE is what
    // is under test; the punctuation is cosmetics.
    const timeSent = () =>
      (
        mockSendEmail.mock.calls[0][0].props as { formattedTime: string }
      ).formattedTime
        .replace(/\./g, '')
        .toLowerCase();

    it('renders 10:00Z as 11:00 for a Dublin salon', async () => {
      seed('Europe/Dublin');
      await notifyOwnerBooking(mockDb as never, validInput);
      expect(timeSent()).toBe('11:00 am');
    });

    it('renders the same instant as 03:00 for a Los Angeles salon', async () => {
      seed('America/Los_Angeles');
      await notifyOwnerBooking(mockDb as never, validInput);
      expect(timeSent()).toBe('03:00 am');
    });

    // An org with no timezone falls back to UTC. Asserted so that fallback is a
    // deliberate, visible behaviour rather than an accident nobody notices.
    it('falls back to UTC when the org has no timezone', async () => {
      seed(undefined);
      await notifyOwnerBooking(mockDb as never, validInput);
      expect(timeSent()).toBe('10:00 am');
    });
  });

  it('should return sent:false when no owner found', async () => {
    mockDb.query.member.findFirst.mockResolvedValueOnce(null);

    const result = await notifyOwnerBooking(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sent).toBe(false);
      expect(result.data.reason).toContain('No owner');
    }
  });

  it('should skip when owner is the assigned practitioner', async () => {
    mockDb.query.member.findFirst.mockResolvedValueOnce({
      userId: 'user_owner',
      role: 'owner',
      user: { id: 'user_owner', name: 'Jane', email: 'jane@salon.com' },
    });
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_123',
      practitionerId: 'prac_1',
      leadId: 'lead_1',
      title: 'Haircut',
      startDate: new Date('2024-06-15T10:00:00Z'),
    });
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      id: 'prac_1',
      name: 'Jane',
      email: 'jane@salon.com',
    });

    const result = await notifyOwnerBooking(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sent).toBe(false);
      expect(result.data.reason).toContain('already notified');
    }
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('should send when owner and practitioner are different people', async () => {
    mockDb.query.member.findFirst.mockResolvedValueOnce({
      userId: 'user_owner',
      role: 'owner',
      user: { id: 'user_owner', name: 'Jane Owner', email: 'jane@salon.com' },
    });
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_123',
      practitionerId: 'prac_1',
      leadId: 'lead_1',
      title: 'Haircut: John Doe',
      startDate: new Date('2024-06-15T10:00:00Z'),
      description: null,
    });
    mockDb.query.practitioner.findFirst
      // First call: dedup check
      .mockResolvedValueOnce({
        id: 'prac_1',
        name: 'Sarah',
        email: 'sarah@salon.com',
      })
      // Second call: practitioner name lookup
      .mockResolvedValueOnce({
        id: 'prac_1',
        name: 'Sarah',
      });
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead_1',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      phone: null,
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      name: 'Test Salon',
    });
    mockSendEmail.mockResolvedValueOnce(undefined);

    const result = await notifyOwnerBooking(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jane@salon.com',
        props: expect.objectContaining({
          practitionerName: 'Sarah',
        }),
      })
    );
  });

  it('should return sent:false when email fails', async () => {
    mockDb.query.member.findFirst.mockResolvedValueOnce({
      userId: 'user_owner',
      role: 'owner',
      user: { id: 'user_owner', name: 'Jane', email: 'jane@salon.com' },
    });
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_123',
      practitionerId: null,
      leadId: null,
      title: 'Haircut',
      startDate: new Date(),
      description: null,
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      name: 'Test Salon',
    });
    mockSendEmail.mockRejectedValueOnce(new Error('Email failed'));

    const result = await notifyOwnerBooking(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(false);
  });

  it('should return VALIDATION_ERROR for missing appointmentId', async () => {
    await expectResult(
      notifyOwnerBooking(mockDb as never, {
        ...validInput,
        appointmentId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return sent:false when appointment not found', async () => {
    mockDb.query.member.findFirst.mockResolvedValueOnce({
      userId: 'user_owner',
      role: 'owner',
      user: { id: 'user_owner', name: 'Jane', email: 'jane@salon.com' },
    });
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);

    const result = await notifyOwnerBooking(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sent).toBe(false);
      expect(result.data.reason).toContain('Appointment not found');
    }
  });
});
