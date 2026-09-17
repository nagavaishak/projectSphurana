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
import { deleteBlockedTimeType } from './delete-blocked-time-type.service.js';

describe('deleteBlockedTimeType', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('deletes a blocked time type', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'btt_1' }]);

    const data = await expectResult(
      deleteBlockedTimeType(mockDb as never, {
        id: 'btt_1',
        organizationId: 'org_1',
      })
    ).toSucceedWith();

    expect(data.id).toBe('btt_1');
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the type does not exist', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      deleteBlockedTimeType(mockDb as never, {
        id: 'btt_missing',
        organizationId: 'org_1',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for missing id', async () => {
    await expectResult(
      deleteBlockedTimeType(
        mockDb as never,
        {
          organizationId: 'org_1',
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      deleteBlockedTimeType(mockDb as never, {
        id: 'btt_1',
        organizationId: 'org_1',
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
