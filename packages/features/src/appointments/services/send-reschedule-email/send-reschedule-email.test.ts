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

import { sendRescheduleEmail } from './send-reschedule-email.service.js';

const mockSendEmail = vi.mocked(sendEmail);

describe('sendRescheduleEmail', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    appointmentId: 'appt_123',
    organizationId: 'org_123',
    oldStartDate: new Date('2024-06-15T10:00:00Z'),
    oldEndDate: new Date('2024-06-15T11:00:00Z'),
  };

  it('should send reschedule email to lead', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_123',
      leadId: 'lead_1',
      title: 'Haircut',
      startDate: new Date('2024-06-20T14:00:00Z'),
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead_1',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      name: 'Test Salon',
    });
    mockSendEmail.mockResolvedValueOnce(undefined);

    const result = await sendRescheduleEmail(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'john@example.com' })
    );
  });

  /**
   * BRANCH ADDRESS (phase 3c). Same gap as the confirmation and the reminder:
   * the patient is told a new time and no place. The NULL-branch case must
   * degrade to no address at all — a pre-backfill row that borrowed the default
   * branch's address would send a Cork patient to Dublin.
   */
  it('names the branch the rescheduled appointment is at', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_123',
      leadId: 'lead_1',
      title: 'Haircut',
      startDate: new Date('2024-06-20T14:00:00Z'),
      locationId: 'loc_cork',
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead_1',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      name: 'Test Salon',
    });
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      id: 'loc_cork',
      slug: 'cork',
      addressLine1: 'Unit 4',
      addressLine2: null,
      city: 'Cork',
      county: null,
      postalCode: 'T12 XY45',
    });
    mockSendEmail.mockResolvedValueOnce(undefined);

    const result = await sendRescheduleEmail(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({
          organizationAddress: 'Unit 4, Cork, T12 XY45',
        }),
      })
    );
  });

  it('sends no address at all when the appointment has no branch', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_123',
      leadId: 'lead_1',
      title: 'Haircut',
      startDate: new Date('2024-06-20T14:00:00Z'),
      locationId: null,
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead_1',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      name: 'Test Salon',
    });
    mockSendEmail.mockResolvedValueOnce(undefined);

    const result = await sendRescheduleEmail(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.query.organizationLocation.findFirst).not.toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({ organizationAddress: undefined }),
      })
    );
  });

  it('should return sent:false when appointment not found', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);

    const result = await sendRescheduleEmail(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(false);
  });

  it('should return sent:false when no lead associated', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_123',
      leadId: null,
      title: 'Haircut',
      startDate: new Date(),
    });

    const result = await sendRescheduleEmail(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(false);
  });

  it('should return sent:false when lead has no email', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_123',
      leadId: 'lead_1',
      title: 'Haircut',
      startDate: new Date(),
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead_1',
      firstName: 'John',
      email: null,
    });

    const result = await sendRescheduleEmail(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(false);
  });

  it('should return VALIDATION_ERROR for missing appointmentId', async () => {
    await expectResult(
      sendRescheduleEmail(mockDb as never, {
        ...validInput,
        appointmentId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
