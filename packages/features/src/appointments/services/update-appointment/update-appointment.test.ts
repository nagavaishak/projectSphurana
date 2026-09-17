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
import { ErrorCodes } from '../../../shared/index.js';
import * as appointmentQueueModule from '../../queue/appointment-queue.js';
import { updateAppointment } from './update-appointment.service.js';

// Restored `vi.spyOn`, NOT `vi.mock` — under `isolate: false` a hoisted
// bare-factory mock of an internal module leaks onto the shared worker graph
// (deleting the exports it omits) and silently misses when an earlier file
// already imported the real module. The service imports through the
// `../../queue/index.js` barrel, whose live getters cannot be redefined, so we
// spy the SOURCE module the barrel forwards to.
let enqueueCalendarSyncSpy: MockInstance;

describe('updateAppointment', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // Calendar sync is enqueued onto the booking worker rather than called
    // inline; stub the queue producer so the test never touches BullMQ/Redis.
    enqueueCalendarSyncSpy = vi
      .spyOn(appointmentQueueModule, 'enqueueCalendarSync')
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    enqueueCalendarSyncSpy.mockRestore();
  });

  const validInput = {
    id: 'appt_123',
    organizationId: 'org_123',
    title: 'Updated Meeting',
  };

  it('should update appointment with valid input', async () => {
    const existingAppointment = {
      id: 'appt_123',
      title: 'Original Meeting',
      organizationId: 'org_123',
    };

    const updatedAppointment = {
      ...existingAppointment,
      title: 'Updated Meeting',
      updatedAt: new Date(),
    };

    mockDb.query.appointment.findFirst.mockResolvedValueOnce(
      existingAppointment
    );
    mockDb.returning.mockResolvedValueOnce([updatedAppointment]);

    const result = await updateAppointment(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Updated Meeting');
    }

    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should return NOT_FOUND when appointment does not exist', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      updateAppointment(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toBe('Appointment not found');
    });

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {
      id: '',
      organizationId: 'org_123',
      title: 'Updated Meeting',
    };

    await expectResult(
      updateAppointment(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.appointment.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      id: 'appt_123',
      organizationId: '',
      title: 'Updated Meeting',
    };

    await expectResult(
      updateAppointment(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.appointment.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR when endDate is before startDate', async () => {
    const invalidInput = {
      id: 'appt_123',
      organizationId: 'org_123',
      startDate: new Date('2024-03-15T11:00:00Z'),
      endDate: new Date('2024-03-15T10:00:00Z'),
    };

    await expectResult(
      updateAppointment(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.appointment.findFirst).not.toHaveBeenCalled();
  });

  it('should update multiple fields at once', async () => {
    const existingAppointment = {
      id: 'appt_123',
      title: 'Original Meeting',
      description: 'Original description',
      status: 'booked',
      organizationId: 'org_123',
    };

    const inputWithMultipleFields = {
      id: 'appt_123',
      organizationId: 'org_123',
      title: 'Updated Meeting',
      description: 'Updated description',
      status: 'completed' as const,
      color: 'green' as const,
    };

    const updatedAppointment = {
      ...existingAppointment,
      ...inputWithMultipleFields,
      updatedAt: new Date(),
    };

    mockDb.query.appointment.findFirst.mockResolvedValueOnce(
      existingAppointment
    );
    mockDb.returning.mockResolvedValueOnce([updatedAppointment]);

    const result = await updateAppointment(
      mockDb as never,
      inputWithMultipleFields
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Updated Meeting');
      expect(result.data.description).toBe('Updated description');
      expect(result.data.status).toBe('completed');
    }
  });

  it('should verify lead belongs to organization when updating leadId', async () => {
    const existingAppointment = {
      id: 'appt_123',
      organizationId: 'org_123',
      leadId: 'lead_old',
    };

    const inputWithNewLead = {
      id: 'appt_123',
      organizationId: 'org_123',
      leadId: 'lead_new',
    };

    // Appointment exists
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(
      existingAppointment
    );
    // Lead not found (belongs to different org)
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      updateAppointment(mockDb as never, inputWithNewLead)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toContain('Lead not found');
    });

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should allow updating leadId when lead exists in organization', async () => {
    const existingAppointment = {
      id: 'appt_123',
      organizationId: 'org_123',
      leadId: 'lead_old',
    };

    const newLead = {
      id: 'lead_new',
      organizationId: 'org_123',
    };

    const inputWithNewLead = {
      id: 'appt_123',
      organizationId: 'org_123',
      leadId: 'lead_new',
    };

    const updatedAppointment = {
      ...existingAppointment,
      leadId: 'lead_new',
      updatedAt: new Date(),
    };

    mockDb.query.appointment.findFirst.mockResolvedValueOnce(
      existingAppointment
    );
    mockDb.query.lead.findFirst.mockResolvedValueOnce(newLead);
    mockDb.returning.mockResolvedValueOnce([updatedAppointment]);

    const result = await updateAppointment(mockDb as never, inputWithNewLead);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.leadId).toBe('lead_new');
    }
  });

  it('should return CONFLICT when updating dates causes overlap', async () => {
    const existingAppointment = {
      id: 'appt_123',
      organizationId: 'org_123',
      title: 'My Meeting',
      startDate: new Date('2024-03-15T10:00:00Z'),
      endDate: new Date('2024-03-15T11:00:00Z'),
      assignedToId: 'user_123',
      status: 'booked',
    };

    const conflictingAppointment = {
      id: 'appt_other',
      title: 'Other Meeting',
      startDate: new Date('2024-03-15T14:00:00Z'),
      endDate: new Date('2024-03-15T15:00:00Z'),
    };

    const inputWithNewDates = {
      id: 'appt_123',
      organizationId: 'org_123',
      startDate: new Date('2024-03-15T14:30:00Z'),
      endDate: new Date('2024-03-15T15:30:00Z'),
    };

    // 1st call: check appointment exists
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(
      existingAppointment
    );
    // 2nd call: overlap check returns a conflict
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(
      conflictingAppointment
    );

    await expectResult(
      updateAppointment(mockDb as never, inputWithNewDates)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.CONFLICT);
      expect(error.message).toContain('Other Meeting');
    });

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('names the clash in the org timezone, not as a UTC ISO string (ENG-792)', async () => {
    const existingAppointment = {
      id: 'appt_123',
      organizationId: 'org_123',
      title: 'My Meeting',
      startDate: new Date('2024-07-15T08:00:00Z'),
      endDate: new Date('2024-07-15T09:00:00Z'),
      assignedToId: 'user_123',
      status: 'booked',
    };

    // 14:00Z in July is 15:00 in Dublin (IST, UTC+1).
    const conflictingAppointment = {
      id: 'appt_other',
      title: 'Other Meeting',
      startDate: new Date('2024-07-15T14:00:00Z'),
      endDate: new Date('2024-07-15T15:00:00Z'),
    };

    mockDb.query.appointment.findFirst.mockResolvedValueOnce(
      existingAppointment
    );
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(
      conflictingAppointment
    );
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      timezone: 'Europe/Dublin',
    });

    await expectResult(
      updateAppointment(mockDb as never, {
        id: 'appt_123',
        organizationId: 'org_123',
        startDate: new Date('2024-07-15T14:30:00Z'),
        endDate: new Date('2024-07-15T15:30:00Z'),
      })
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.CONFLICT);
      expect(error.message).toContain('Mon, 15 Jul, 15:00–16:00');
      expect(error.message).not.toContain('T14:00:00.000Z');
      // The machine-readable instants stay UTC for the client to re-send.
      expect(error.details).toMatchObject({
        conflictingAppointmentId: 'appt_other',
        conflictStartDate: '2024-07-15T14:00:00.000Z',
      });
    });

    // The org is read exactly once, and only because the conflict needed it.
    expect(mockDb.query.organization.findFirst).toHaveBeenCalledTimes(1);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should run conflict check when reactivating a cancelled appointment (status-only change)', async () => {
    const existingAppointment = {
      id: 'appt_123',
      organizationId: 'org_123',
      title: 'My Meeting',
      startDate: new Date('2024-03-15T10:00:00Z'),
      endDate: new Date('2024-03-15T11:00:00Z'),
      assignedToId: 'user_123',
      status: 'cancelled',
    };

    const conflictingAppointment = {
      id: 'appt_other',
      title: 'Other Meeting',
      startDate: new Date('2024-03-15T10:30:00Z'),
      endDate: new Date('2024-03-15T11:30:00Z'),
    };

    // Status-only change: cancelled -> booked, dates unchanged.
    const reactivateInput = {
      id: 'appt_123',
      organizationId: 'org_123',
      status: 'booked' as const,
    };

    // 1st call: existence check. 2nd call: overlap check (must run now).
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(
      existingAppointment
    );
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(
      conflictingAppointment
    );

    await expectResult(
      updateAppointment(mockDb as never, reactivateInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.CONFLICT);
      expect(error.message).toContain('Other Meeting');
    });

    // Overlap check ran (2 findFirst calls) and no update happened.
    expect(mockDb.query.appointment.findFirst).toHaveBeenCalledTimes(2);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should skip conflict check when dates and assignee are unchanged', async () => {
    const existingAppointment = {
      id: 'appt_123',
      organizationId: 'org_123',
      title: 'Original Meeting',
      startDate: new Date('2024-03-15T10:00:00Z'),
      endDate: new Date('2024-03-15T11:00:00Z'),
      assignedToId: 'user_123',
      status: 'booked',
    };

    const inputTitleOnly = {
      id: 'appt_123',
      organizationId: 'org_123',
      title: 'Renamed Meeting',
    };

    const updatedAppointment = {
      ...existingAppointment,
      title: 'Renamed Meeting',
      updatedAt: new Date(),
    };

    // Only 1 findFirst call (existing check), no overlap check needed
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(
      existingAppointment
    );
    mockDb.returning.mockResolvedValueOnce([updatedAppointment]);

    const result = await updateAppointment(mockDb as never, inputTitleOnly);

    expect(result.success).toBe(true);
    // appointment.findFirst should have been called only once (existence check)
    expect(mockDb.query.appointment.findFirst).toHaveBeenCalledTimes(1);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.appointment.findFirst.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(
      updateAppointment(mockDb as never, validInput)
    ).rejects.toThrow('Database connection failed');
  });
});
