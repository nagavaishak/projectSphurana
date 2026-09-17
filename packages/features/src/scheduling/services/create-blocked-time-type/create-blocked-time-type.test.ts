import { drizzleUniqueViolation } from '@borradh-workspace/database';
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
import { createBlockedTimeType } from './create-blocked-time-type.service.js';

describe('createBlockedTimeType', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('creates a blocked time type with valid input', async () => {
    const row = {
      id: 'btt_1',
      organizationId: 'org_1',
      name: 'Lunch',
      durationMinutes: 30,
      paid: false,
    };
    mockDb.returning.mockResolvedValueOnce([row]);

    const data = await expectResult(
      createBlockedTimeType(mockDb as never, {
        organizationId: 'org_1',
        name: 'Lunch',
        durationMinutes: 30,
      })
    ).toSucceedWith();

    expect(data.name).toBe('Lunch');
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when duration is not a multiple of 5', async () => {
    await expectResult(
      createBlockedTimeType(mockDb as never, {
        organizationId: 'org_1',
        name: 'Lunch',
        durationMinutes: 32,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns ALREADY_EXISTS on duplicate name', async () => {
    mockDb.returning.mockRejectedValueOnce(
      drizzleUniqueViolation('blocked_time_type_org_name_unique')
    );

    await expectResult(
      createBlockedTimeType(mockDb as never, {
        organizationId: 'org_1',
        name: 'Lunch',
        durationMinutes: 30,
      })
    ).toFailWithCode(ErrorCodes.ALREADY_EXISTS);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      createBlockedTimeType(mockDb as never, {
        organizationId: 'org_1',
        name: 'Lunch',
        durationMinutes: 30,
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
