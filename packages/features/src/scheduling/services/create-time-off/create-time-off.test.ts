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
import { createTimeOff } from './create-time-off.service.js';

const validInput = {
  organizationId: 'org_1',
  practitionerId: 'prac_1',
  startDate: new Date('2026-08-01T00:00:00Z'),
  endDate: new Date('2026-08-08T00:00:00Z'),
  createdById: 'user_1',
};

describe('createTimeOff', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('creates time off with defaults (annual_leave, allDay, approved)', async () => {
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'to_1',
        ...validInput,
        type: 'annual_leave',
        allDay: true,
        approved: true,
      },
    ]);

    const data = await expectResult(
      createTimeOff(mockDb as never, validInput)
    ).toSucceedWith();

    expect(data.type).toBe('annual_leave');
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for an invalid type', async () => {
    await expectResult(
      createTimeOff(mockDb as never, {
        ...validInput,
        type: 'holiday' as never,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when endDate is before startDate', async () => {
    await expectResult(
      createTimeOff(mockDb as never, {
        ...validInput,
        endDate: new Date('2026-07-01T00:00:00Z'),
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      createTimeOff(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
