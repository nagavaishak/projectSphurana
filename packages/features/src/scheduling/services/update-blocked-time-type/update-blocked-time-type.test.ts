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
import { updateBlockedTimeType } from './update-blocked-time-type.service.js';

describe('updateBlockedTimeType', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('updates a blocked time type', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 'btt_1', name: 'Long Lunch', durationMinutes: 60 },
    ]);

    const data = await expectResult(
      updateBlockedTimeType(mockDb as never, {
        id: 'btt_1',
        organizationId: 'org_1',
        name: 'Long Lunch',
        durationMinutes: 60,
      })
    ).toSucceedWith();

    expect(data.name).toBe('Long Lunch');
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the type does not exist', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      updateBlockedTimeType(mockDb as never, {
        id: 'btt_missing',
        organizationId: 'org_1',
        name: 'X',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for invalid duration', async () => {
    await expectResult(
      updateBlockedTimeType(mockDb as never, {
        id: 'btt_1',
        organizationId: 'org_1',
        durationMinutes: 3,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      updateBlockedTimeType(mockDb as never, {
        id: 'btt_1',
        organizationId: 'org_1',
        paid: true,
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('returns ALREADY_EXISTS on a name collision', async () => {
    mockDb.returning.mockRejectedValueOnce(
      drizzleUniqueViolation('blocked_time_type_org_name_unique')
    );

    await expectResult(
      updateBlockedTimeType(mockDb as never, {
        id: 'btt_1',
        organizationId: 'org_1',
        name: 'Long Lunch',
      })
    ).toFailWithCode(ErrorCodes.ALREADY_EXISTS);
  });
});
