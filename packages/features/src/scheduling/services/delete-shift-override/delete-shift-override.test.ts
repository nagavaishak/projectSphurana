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
import { deleteShiftOverride } from './delete-shift-override.service.js';

describe('deleteShiftOverride', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('deletes override rows for the date', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 's_1' }, { id: 's_2' }]);

    const data = await expectResult(
      deleteShiftOverride(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        date: '2026-07-10',
      })
    ).toSucceedWith();

    expect(data.deleted).toBe(2);
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('succeeds with zero deletions when no override exists', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    const data = await expectResult(
      deleteShiftOverride(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        date: '2026-07-10',
      })
    ).toSucceedWith();

    expect(data.deleted).toBe(0);
  });

  it('returns VALIDATION_ERROR for a malformed date', async () => {
    await expectResult(
      deleteShiftOverride(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        date: 'not-a-date',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      deleteShiftOverride(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        date: '2026-07-10',
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
