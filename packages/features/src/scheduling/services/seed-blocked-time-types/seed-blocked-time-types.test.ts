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
import { seedBlockedTimeTypes } from './seed-blocked-time-types.service.js';

describe('seedBlockedTimeTypes', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('seeds all three presets when none exist', async () => {
    mockDb.where.mockResolvedValueOnce([]);
    mockDb.returning.mockResolvedValueOnce([
      { id: '1', name: 'Lunch' },
      { id: '2', name: 'Training' },
      { id: '3', name: 'Meeting' },
    ]);

    const data = await expectResult(
      seedBlockedTimeTypes(mockDb as never, { organizationId: 'org_1' })
    ).toSucceedWith();

    expect(data.created).toHaveLength(3);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('is idempotent — inserts nothing when presets already exist', async () => {
    mockDb.where.mockResolvedValueOnce([
      { name: 'Lunch' },
      { name: 'Training' },
      { name: 'Meeting' },
    ]);

    const data = await expectResult(
      seedBlockedTimeTypes(mockDb as never, { organizationId: 'org_1' })
    ).toSucceedWith();

    expect(data.created).toHaveLength(0);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('only inserts the missing presets', async () => {
    mockDb.where.mockResolvedValueOnce([{ name: 'Lunch' }]);
    mockDb.returning.mockResolvedValueOnce([
      { id: '2', name: 'Training' },
      { id: '3', name: 'Meeting' },
    ]);

    const data = await expectResult(
      seedBlockedTimeTypes(mockDb as never, { organizationId: 'org_1' })
    ).toSucceedWith();

    expect(data.created).toHaveLength(2);
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      seedBlockedTimeTypes(mockDb as never, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.where.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      seedBlockedTimeTypes(mockDb as never, { organizationId: 'org_1' })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
