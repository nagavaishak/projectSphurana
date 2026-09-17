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
import { updateBlockedTime } from './update-blocked-time.service.js';

const series = {
  id: 'bt_1',
  organizationId: 'org_1',
  blockedTimeTypeId: null,
  title: 'Lunch',
  description: null,
  startDate: new Date('2026-07-06T12:00:00Z'),
  endDate: new Date('2026-07-06T12:30:00Z'),
  allDay: false,
  timezone: 'UTC',
  rrule: null,
  recurrenceEndDate: null,
  paid: false,
  createdById: 'user_1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('updateBlockedTime', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it("updates the series with scope='all'", async () => {
    mockDb.where
      .mockResolvedValueOnce([series]) // series lookup
      .mockReturnValueOnce(mockDb) // update chain .where()
      .mockResolvedValueOnce([]); // loadPractitionerIds
    mockDb.returning.mockResolvedValueOnce([{ ...series, title: 'Break' }]);

    const data = await expectResult(
      updateBlockedTime(mockDb as never, {
        id: 'bt_1',
        organizationId: 'org_1',
        title: 'Break',
      })
    ).toSucceedWith();

    expect(data.title).toBe('Break');
    expect(data.practitionerIds).toEqual([]);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it("creates an exception with scope='this' on a recurring series", async () => {
    mockDb.where
      .mockResolvedValueOnce([{ ...series, rrule: 'FREQ=WEEKLY' }])
      .mockResolvedValueOnce([]); // loadPractitionerIds

    const data = await expectResult(
      updateBlockedTime(mockDb as never, {
        id: 'bt_1',
        organizationId: 'org_1',
        scope: 'this',
        originalStart: new Date('2026-07-13T12:00:00Z'),
        title: 'Moved lunch',
      })
    ).toSucceedWith();

    expect(data.id).toBe('bt_1');
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.onConflictDoUpdate).toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("requires originalStart for scope='this' on recurring series", async () => {
    mockDb.where.mockResolvedValueOnce([{ ...series, rrule: 'FREQ=WEEKLY' }]);

    await expectResult(
      updateBlockedTime(mockDb as never, {
        id: 'bt_1',
        organizationId: 'org_1',
        scope: 'this',
        title: 'X',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it("truncates and creates a new series with scope='following'", async () => {
    mockDb.where
      .mockResolvedValueOnce([{ ...series, rrule: 'FREQ=WEEKLY' }]) // lookup
      .mockReturnValueOnce(mockDb) // truncate update .where()
      .mockResolvedValueOnce([]); // loadPractitionerIds (for copy)
    mockDb.returning
      .mockResolvedValueOnce([]) // truncate update returning
      .mockResolvedValueOnce([
        { ...series, id: 'bt_new', rrule: 'FREQ=WEEKLY' },
      ]); // new series insert

    const data = await expectResult(
      updateBlockedTime(mockDb as never, {
        id: 'bt_1',
        organizationId: 'org_1',
        scope: 'following',
        originalStart: new Date('2026-07-13T12:00:00Z'),
        createdById: 'user_1',
        title: 'New title',
      })
    ).toSucceedWith();

    expect(data.id).toBe('bt_new');
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the blocked time does not exist', async () => {
    mockDb.where.mockResolvedValueOnce([]);

    await expectResult(
      updateBlockedTime(mockDb as never, {
        id: 'bt_missing',
        organizationId: 'org_1',
        title: 'X',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.where.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      updateBlockedTime(mockDb as never, {
        id: 'bt_1',
        organizationId: 'org_1',
        title: 'X',
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
