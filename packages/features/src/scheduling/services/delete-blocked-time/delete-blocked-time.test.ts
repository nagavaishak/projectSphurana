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
import { deleteBlockedTime } from './delete-blocked-time.service.js';

const series = {
  id: 'bt_1',
  organizationId: 'org_1',
  rrule: null,
  startDate: new Date('2026-07-06T12:00:00Z'),
  endDate: new Date('2026-07-06T12:30:00Z'),
};

describe('deleteBlockedTime', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it("deletes the whole series with scope='all'", async () => {
    mockDb.where
      .mockResolvedValueOnce([series]) // lookup
      .mockReturnValueOnce(mockDb); // delete chain .where()
    mockDb.returning.mockResolvedValueOnce([{ id: 'bt_1' }]);

    const data = await expectResult(
      deleteBlockedTime(mockDb as never, {
        id: 'bt_1',
        organizationId: 'org_1',
      })
    ).toSucceedWith();

    expect(data.id).toBe('bt_1');
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it("cancels a single occurrence with scope='this'", async () => {
    mockDb.where.mockResolvedValueOnce([{ ...series, rrule: 'FREQ=WEEKLY' }]);

    const data = await expectResult(
      deleteBlockedTime(mockDb as never, {
        id: 'bt_1',
        organizationId: 'org_1',
        scope: 'this',
        originalStart: new Date('2026-07-13T12:00:00Z'),
      })
    ).toSucceedWith();

    expect(data.id).toBe('bt_1');
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it("truncates the series with scope='following'", async () => {
    mockDb.where
      .mockResolvedValueOnce([{ ...series, rrule: 'FREQ=WEEKLY' }])
      .mockReturnValueOnce(mockDb); // update chain .where()
    mockDb.returning.mockResolvedValueOnce([]);

    const data = await expectResult(
      deleteBlockedTime(mockDb as never, {
        id: 'bt_1',
        organizationId: 'org_1',
        scope: 'following',
        originalStart: new Date('2026-07-13T12:00:00Z'),
      })
    ).toSucceedWith();

    expect(data.id).toBe('bt_1');
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it("requires originalStart for scope='this' on recurring series", async () => {
    mockDb.where.mockResolvedValueOnce([{ ...series, rrule: 'FREQ=WEEKLY' }]);

    await expectResult(
      deleteBlockedTime(mockDb as never, {
        id: 'bt_1',
        organizationId: 'org_1',
        scope: 'this',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns NOT_FOUND when the blocked time does not exist', async () => {
    mockDb.where.mockResolvedValueOnce([]);

    await expectResult(
      deleteBlockedTime(mockDb as never, {
        id: 'bt_missing',
        organizationId: 'org_1',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.where.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      deleteBlockedTime(mockDb as never, {
        id: 'bt_1',
        organizationId: 'org_1',
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
