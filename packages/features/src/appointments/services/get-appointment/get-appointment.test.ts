import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { getAppointment } from './get-appointment.service.js';

describe('getAppointment', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'appt_123',
    organizationId: 'org_123',
  };

  it('should return appointment when found', async () => {
    const mockAppointment = {
      id: 'appt_123',
      title: 'Consultation',
      startDate: new Date('2024-03-15T10:00:00Z'),
      endDate: new Date('2024-03-15T11:00:00Z'),
      organizationId: 'org_123',
      leadId: 'lead_123',
      assignedToId: 'user_123',
      lead: {
        id: 'lead_123',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        phone: '+1234567890',
      },
      assignedTo: {
        id: 'user_123',
        name: 'Jane Smith',
        email: 'jane@example.com',
        image: null,
      },
    };

    mockDb.query.appointment.findFirst.mockResolvedValueOnce(mockAppointment);

    const result = await getAppointment(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('appt_123');
      expect(result.data.title).toBe('Consultation');
      expect(result.data.lead.firstName).toBe('John');
      expect(result.data.assignedTo.name).toBe('Jane Smith');
    }
  });

  it('should return NOT_FOUND when appointment does not exist', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);

    await expectResult(getAppointment(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(error.message).toBe('Appointment not found');
      }
    );
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {
      id: '',
      organizationId: 'org_123',
    };

    await expectResult(
      getAppointment(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.appointment.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      id: 'appt_123',
      organizationId: '',
    };

    await expectResult(
      getAppointment(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.appointment.findFirst).not.toHaveBeenCalled();
  });

  it('should not return appointment from different organization', async () => {
    // The query includes organization filter, so different org should return null
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);

    const inputWithDifferentOrg = {
      id: 'appt_123',
      organizationId: 'different_org',
    };

    await expectResult(
      getAppointment(mockDb as never, inputWithDifferentOrg)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
    });
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.appointment.findFirst.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(getAppointment(mockDb as never, validInput)).rejects.toThrow(
      'Database connection failed'
    );
  });
});
