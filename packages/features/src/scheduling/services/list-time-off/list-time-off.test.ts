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
import { listTimeOff } from './list-time-off.service.js';

const from = new Date('2026-08-01T00:00:00Z');
const to = new Date('2026-08-31T23:59:59Z');

describe('listTimeOff', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('lists time off sorted by start date', async () => {
    mockDb.where.mockResolvedValueOnce([
      { id: 'to_2', startDate: new Date('2026-08-10T00:00:00Z') },
      { id: 'to_1', startDate: new Date('2026-08-02T00:00:00Z') },
    ]);

    const data = await expectResult(
      listTimeOff(mockDb as never, { organizationId: 'org_1', from, to })
    ).toSucceedWith();

    expect(data.map((t: { id: string }) => t.id)).toEqual(['to_1', 'to_2']);
  });

  it('returns VALIDATION_ERROR when window is inverted', async () => {
    await expectResult(
      listTimeOff(mockDb as never, {
        organizationId: 'org_1',
        from: to,
        to: from,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.where.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      listTimeOff(mockDb as never, { organizationId: 'org_1', from, to })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
