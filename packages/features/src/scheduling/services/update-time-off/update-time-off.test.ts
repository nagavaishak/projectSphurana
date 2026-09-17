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
import { updateTimeOff } from './update-time-off.service.js';

describe('updateTimeOff', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('updates time off', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 'to_1', type: 'sick_leave' },
    ]);

    const data = await expectResult(
      updateTimeOff(mockDb as never, {
        id: 'to_1',
        organizationId: 'org_1',
        type: 'sick_leave',
      })
    ).toSucceedWith();

    expect(data.type).toBe('sick_leave');
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('returns NOT_FOUND when time off does not exist', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      updateTimeOff(mockDb as never, {
        id: 'to_missing',
        organizationId: 'org_1',
        approved: false,
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for an invalid type', async () => {
    await expectResult(
      updateTimeOff(mockDb as never, {
        id: 'to_1',
        organizationId: 'org_1',
        type: 'vacation' as never,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      updateTimeOff(mockDb as never, {
        id: 'to_1',
        organizationId: 'org_1',
        approved: true,
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
