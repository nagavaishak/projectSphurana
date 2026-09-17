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
import { listBlockedTimeTypes } from './list-blocked-time-types.service.js';

describe('listBlockedTimeTypes', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('lists blocked time types sorted by name', async () => {
    mockDb.where.mockResolvedValueOnce([
      { id: 'btt_2', name: 'Training' },
      { id: 'btt_1', name: 'Lunch' },
    ]);

    const data = await expectResult(
      listBlockedTimeTypes(mockDb as never, { organizationId: 'org_1' })
    ).toSucceedWith();

    expect(data.map((t: { name: string }) => t.name)).toEqual([
      'Lunch',
      'Training',
    ]);
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      listBlockedTimeTypes(mockDb as never, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.where.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      listBlockedTimeTypes(mockDb as never, { organizationId: 'org_1' })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
