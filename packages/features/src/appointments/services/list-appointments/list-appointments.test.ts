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
import { listAppointments } from './list-appointments.service.js';

describe('listAppointments', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // Total is a COUNT(*) via db.select({ value: count() }).from().where().
    // Default it to 0; tests that assert a specific total override it.
    mockDb.from.mockReturnValue({
      where: vi.fn().mockResolvedValue([{ value: 0 }]),
    } as never);
  });

  const validInput = {
    organizationId: 'org_123',
  };

  it('should return list of appointments', async () => {
    const mockAppointments = [
      {
        id: 'appt_1',
        title: 'Meeting 1',
        startDate: new Date('2024-03-15T10:00:00Z'),
        endDate: new Date('2024-03-15T11:00:00Z'),
        organizationId: 'org_123',
        lead: {
          id: 'lead_1',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          phone: null,
        },
        assignedTo: {
          id: 'user_1',
          name: 'Jane',
          email: 'jane@example.com',
          image: null,
        },
      },
      {
        id: 'appt_2',
        title: 'Meeting 2',
        startDate: new Date('2024-03-16T10:00:00Z'),
        endDate: new Date('2024-03-16T11:00:00Z'),
        organizationId: 'org_123',
        lead: {
          id: 'lead_2',
          firstName: 'Bob',
          lastName: 'Smith',
          email: 'bob@example.com',
          phone: null,
        },
        assignedTo: {
          id: 'user_1',
          name: 'Jane',
          email: 'jane@example.com',
          image: null,
        },
      },
    ];

    // Mock for items query
    mockDb.query.appointment.findMany.mockResolvedValueOnce(mockAppointments);
    // COUNT(*) query returns total = 2
    mockDb.from.mockReturnValueOnce({
      where: vi.fn().mockResolvedValueOnce([{ value: 2 }]),
    } as never);

    const result = await listAppointments(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.total).toBe(2);
      expect(result.data.items[0].title).toBe('Meeting 1');
    }
  });

  it('should return empty list when no appointments exist', async () => {
    mockDb.query.appointment.findMany.mockResolvedValueOnce([]);

    const result = await listAppointments(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(0);
      expect(result.data.total).toBe(0);
    }
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      organizationId: '',
    };

    await expectResult(
      listAppointments(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.appointment.findMany).not.toHaveBeenCalled();
  });

  it('should filter by leadId', async () => {
    const inputWithLeadFilter = {
      ...validInput,
      leadId: 'lead_123',
    };

    mockDb.query.appointment.findMany.mockResolvedValueOnce([]);

    const result = await listAppointments(mockDb as never, inputWithLeadFilter);

    expect(result.success).toBe(true);
    expect(mockDb.query.appointment.findMany).toHaveBeenCalled();
  });

  it('should filter by assignedToId', async () => {
    const inputWithAssignedFilter = {
      ...validInput,
      assignedToId: 'user_123',
    };

    mockDb.query.appointment.findMany.mockResolvedValueOnce([]);

    const result = await listAppointments(
      mockDb as never,
      inputWithAssignedFilter
    );

    expect(result.success).toBe(true);
    expect(mockDb.query.appointment.findMany).toHaveBeenCalled();
  });

  it('should filter by status', async () => {
    const inputWithStatusFilter = {
      ...validInput,
      status: 'booked' as const,
    };

    mockDb.query.appointment.findMany.mockResolvedValueOnce([]);

    const result = await listAppointments(
      mockDb as never,
      inputWithStatusFilter
    );

    expect(result.success).toBe(true);
    expect(mockDb.query.appointment.findMany).toHaveBeenCalled();
  });

  it('should filter by date range', async () => {
    const inputWithDateFilter = {
      ...validInput,
      startDateFrom: new Date('2024-03-01'),
      startDateTo: new Date('2024-03-31'),
    };

    mockDb.query.appointment.findMany.mockResolvedValueOnce([]);

    const result = await listAppointments(mockDb as never, inputWithDateFilter);

    expect(result.success).toBe(true);
    expect(mockDb.query.appointment.findMany).toHaveBeenCalled();
  });

  it('should apply pagination with limit and offset', async () => {
    const inputWithPagination = {
      ...validInput,
      limit: 10,
      offset: 20,
    };

    mockDb.query.appointment.findMany.mockResolvedValueOnce([]);

    const result = await listAppointments(mockDb as never, inputWithPagination);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.offset).toBe(20);
    }
  });

  it('should use default pagination values', async () => {
    mockDb.query.appointment.findMany.mockResolvedValueOnce([]);

    const result = await listAppointments(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50); // default from schema
      expect(result.data.offset).toBe(0); // default from schema
    }
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.appointment.findMany.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(listAppointments(mockDb as never, validInput)).rejects.toThrow(
      'Database connection failed'
    );
  });
});
