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

import { notifyPractitionerBooking } from './notify-practitioner-booking.service.js';

const mockSendEmail = vi.mocked(sendEmail);

describe('notifyPractitionerBooking', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    appointmentId: 'appt_123',
    organizationId: 'org_123',
  };

  it('should send booking notification email', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_123',
      practitionerId: 'prac_1',
      leadId: 'lead_1',
      title: 'Haircut',
      startDate: new Date('2024-06-15T10:00:00Z'),
      description: 'Notes here',
    });
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      id: 'prac_1',
      name: 'Jane',
      email: 'jane@salon.com',
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

    const result = await notifyPractitionerBooking(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'jane@salon.com' })
    );
  });

  it('should return sent:false when no practitioner assigned', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_123',
      practitionerId: null,
    });

    const result = await notifyPractitionerBooking(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sent).toBe(false);
      expect(result.data.reason).toContain('No practitioner');
    }
  });

  it('should return sent:false when practitioner has no email', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_123',
      practitionerId: 'prac_1',
    });
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      id: 'prac_1',
      name: 'Jane',
      email: null,
    });

    const result = await notifyPractitionerBooking(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(false);
  });

  it('should return sent:false when email fails', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_123',
      practitionerId: 'prac_1',
      leadId: null,
      title: 'Haircut',
      startDate: new Date(),
    });
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      id: 'prac_1',
      name: 'Jane',
      email: 'jane@salon.com',
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      name: 'Test Salon',
    });
    mockSendEmail.mockRejectedValueOnce(new Error('Email failed'));

    const result = await notifyPractitionerBooking(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(false);
  });

  it('should return VALIDATION_ERROR for missing appointmentId', async () => {
    await expectResult(
      notifyPractitionerBooking(mockDb as never, {
        ...validInput,
        appointmentId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
