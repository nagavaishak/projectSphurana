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
import { createBlockedTime } from './create-blocked-time.service.js';

const validInput = {
  organizationId: 'org_1',
  title: 'Lunch break',
  startDate: new Date('2026-07-06T12:00:00Z'),
  endDate: new Date('2026-07-06T12:30:00Z'),
  createdById: 'user_1',
};

describe('createBlockedTime', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('creates an ad-hoc blocked time (org-wide, no practitioners)', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 'bt_1', ...validInput, paid: false },
    ]);

    const data = await expectResult(
      createBlockedTime(mockDb as never, validInput)
    ).toSucceedWith();

    expect(data.id).toBe('bt_1');
    expect(data.practitionerIds).toEqual([]);
    // Only the series insert — no join rows for org-wide blocks
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });

  it('creates join rows for targeted practitioners', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 'bt_1', ...validInput, paid: false },
    ]);
    mockDb.values.mockReturnValueOnce(mockDb).mockResolvedValueOnce([]);

    const data = await expectResult(
      createBlockedTime(mockDb as never, {
        ...validInput,
        practitionerIds: ['prac_1', 'prac_2'],
      })
    ).toSucceedWith();

    expect(data.practitionerIds).toEqual(['prac_1', 'prac_2']);
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
  });

  it('copies paid from the blocked time type when not set', async () => {
    mockDb.where.mockResolvedValueOnce([
      { id: 'btt_1', organizationId: 'org_1', paid: true },
    ]);
    mockDb.returning.mockResolvedValueOnce([
      { id: 'bt_1', ...validInput, paid: true },
    ]);

    const data = await expectResult(
      createBlockedTime(mockDb as never, {
        ...validInput,
        blockedTimeTypeId: 'btt_1',
      })
    ).toSucceedWith();

    expect(data.paid).toBe(true);
  });

  it('returns NOT_FOUND when the referenced type does not exist', async () => {
    mockDb.where.mockResolvedValueOnce([]);

    await expectResult(
      createBlockedTime(mockDb as never, {
        ...validInput,
        blockedTimeTypeId: 'btt_missing',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR when endDate is before startDate', async () => {
    await expectResult(
      createBlockedTime(mockDb as never, {
        ...validInput,
        endDate: new Date('2026-07-06T11:00:00Z'),
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      createBlockedTime(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
