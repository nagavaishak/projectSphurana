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
import { setWeeklyShifts } from './set-weekly-shifts.service.js';

describe('setWeeklyShifts', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // Default: the practitioner belongs to the caller's org so the ownership
    // check passes. Overridden in the NOT_FOUND case below.
    mockDb.query.practitioner.findFirst.mockResolvedValue({ id: 'prac_1' });
  });

  it('replaces weekly rows for the practitioner', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 's_1', dayOfWeek: 1, startMinutes: 540, endMinutes: 1020 },
    ]);

    const data = await expectResult(
      setWeeklyShifts(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        days: [
          {
            dayOfWeek: 1,
            intervals: [{ startMinutes: 540, endMinutes: 1020 }],
          },
        ],
      })
    ).toSucceedWith();

    expect(data).toHaveLength(1);
    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('accepts an empty pattern (deletes all weekly rows)', async () => {
    const data = await expectResult(
      setWeeklyShifts(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        days: [],
      })
    ).toSucceedWith();

    expect(data).toEqual([]);
    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for overlapping intervals', async () => {
    await expectResult(
      setWeeklyShifts(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        days: [
          {
            dayOfWeek: 1,
            intervals: [
              { startMinutes: 540, endMinutes: 720 },
              { startMinutes: 700, endMinutes: 900 },
            ],
          },
        ],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for an inverted interval', async () => {
    await expectResult(
      setWeeklyShifts(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        days: [
          { dayOfWeek: 2, intervals: [{ startMinutes: 900, endMinutes: 540 }] },
        ],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for duplicate days', async () => {
    await expectResult(
      setWeeklyShifts(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        days: [
          { dayOfWeek: 1, intervals: [{ startMinutes: 540, endMinutes: 720 }] },
          { dayOfWeek: 1, intervals: [{ startMinutes: 780, endMinutes: 900 }] },
        ],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns NOT_FOUND when the practitioner is not in the org', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(undefined);

    await expectResult(
      setWeeklyShifts(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_other',
        days: [
          {
            dayOfWeek: 1,
            intervals: [{ startMinutes: 540, endMinutes: 1020 }],
          },
        ],
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.where.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      setWeeklyShifts(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        days: [],
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
