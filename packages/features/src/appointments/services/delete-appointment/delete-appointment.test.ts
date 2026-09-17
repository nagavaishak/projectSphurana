import { isFeatureOn } from '@borradh-workspace/observability';
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
import * as syncToCalendarModule from '../../../calendar/services/sync-to-calendar/sync-to-calendar.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import { deleteAppointment } from './delete-appointment.service.js';

// Restored `vi.spyOn`, NOT `vi.mock` — under `isolate: false` all files in a
// worker share one module graph, so a hoisted bare-factory mock of an internal
// module both leaks outward (deleting the exports it omits for every later
// file) and silently misses whenever an earlier file already imported the real
// module. A run-time spy is load-order independent and restores cleanly.
let syncToCalendarSpy: MockInstance;

describe('deleteAppointment', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFeatureOn).mockResolvedValue(true);
    mockDb._resetMocks();
    syncToCalendarSpy = vi
      .spyOn(syncToCalendarModule, 'syncToCalendar')
      .mockResolvedValue({
        success: true,
        data: { synced: false },
      } as never);
  });

  afterEach(() => {
    syncToCalendarSpy.mockRestore();
  });

  const validInput = {
    id: 'appt_123',
    organizationId: 'org_123',
  };

  it('should delete appointment when it exists', async () => {
    const existingAppointment = {
      id: 'appt_123',
      title: 'Meeting',
      organizationId: 'org_123',
    };

    mockDb.query.appointment.findFirst.mockResolvedValueOnce(
      existingAppointment
    );

    const result = await deleteAppointment(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }

    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({
      deletedAt: expect.any(Date),
    });
  });

  it('should return NOT_FOUND when appointment does not exist', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      deleteAppointment(mockDb as never, validInput)
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
    };

    await expectResult(
      deleteAppointment(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.appointment.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      id: 'appt_123',
      organizationId: '',
    };

    await expectResult(
      deleteAppointment(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.appointment.findFirst).not.toHaveBeenCalled();
  });

  it('should not delete appointment from different organization', async () => {
    // The query includes organization filter, so different org should return null
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);

    const inputWithDifferentOrg = {
      id: 'appt_123',
      organizationId: 'different_org',
    };

    await expectResult(
      deleteAppointment(mockDb as never, inputWithDifferentOrg)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
    });

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.appointment.findFirst.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(
      deleteAppointment(mockDb as never, validInput)
    ).rejects.toThrow('Database connection failed');
  });

  /**
   * The HARD-delete path — reached only when `killswitch-soft-deletes` is off.
   * Every test above pins the flag ON, so none of them reach this branch, and
   * it is the branch where a cascade used to destroy a signed consent form.
   */
  describe('hard delete (soft-deletes killswitch off)', () => {
    beforeEach(() => {
      vi.mocked(isFeatureOn).mockResolvedValue(false);
    });

    it('purges pending consent forms and deletes the appointment', async () => {
      // releasePendingConsentForms: DELETE pending, then SELECT completed.
      mockDb.where.mockResolvedValueOnce(undefined as never); // the DELETE
      mockDb.where.mockResolvedValueOnce([] as never); // no signed forms

      const result = await deleteAppointment(mockDb as never, validInput);

      expect(result.success).toBe(true);
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('refuses with CONFLICT when a SIGNED consent form is attached', async () => {
      mockDb.where.mockResolvedValueOnce(undefined as never); // the DELETE
      mockDb.where.mockResolvedValueOnce([{ id: 'sub_1' }] as never); // signed

      await expectResult(
        deleteAppointment(mockDb as never, validInput)
      ).toFailWith((error) => {
        expect(error.code).toBe(ErrorCodes.CONFLICT);
        expect(error.message).toMatch(/signed consent/i);
      });

      // The appointment row itself must survive. Without this the FK would
      // raise instead, surfacing as a 500 rather than a explained refusal.
      expect(mockDb.delete).toHaveBeenCalledTimes(1); // only the pending purge
    });
  });
});
