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
import { listShifts } from './list-shifts.service.js';

// 2026-07-06 is a Monday; window covers Mon..Sun (one week)
const from = new Date(2026, 6, 6);
const to = new Date(2026, 6, 12);

const weeklyMonday = {
  id: 's_w1',
  organizationId: 'org_1',
  practitionerId: 'prac_1',
  locationId: null,
  dayOfWeek: 1,
  date: null,
  startMinutes: 540,
  endMinutes: 1020,
  isOff: false,
};

describe('listShifts', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('resolves weekly pattern rows into dated days', async () => {
    mockDb.where.mockResolvedValueOnce([weeklyMonday]);

    const data = await expectResult(
      listShifts(mockDb as never, { organizationId: 'org_1', from, to })
    ).toSucceedWith();

    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      practitionerId: 'prac_1',
      date: '2026-07-06',
      isOff: false,
      source: 'weekly',
    });
    expect(data[0].intervals[0].startMinutes).toBe(540);
  });

  it('override rows replace the weekly pattern for that date', async () => {
    mockDb.where.mockResolvedValueOnce([
      weeklyMonday,
      {
        ...weeklyMonday,
        id: 's_o1',
        dayOfWeek: null,
        date: '2026-07-06',
        startMinutes: 600,
        endMinutes: 720,
      },
    ]);

    const data = await expectResult(
      listShifts(mockDb as never, { organizationId: 'org_1', from, to })
    ).toSucceedWith();

    expect(data).toHaveLength(1);
    expect(data[0].source).toBe('override');
    expect(data[0].intervals).toHaveLength(1);
    expect(data[0].intervals[0].startMinutes).toBe(600);
  });

  it('an isOff override yields an off day with no intervals', async () => {
    mockDb.where.mockResolvedValueOnce([
      weeklyMonday,
      {
        ...weeklyMonday,
        id: 's_off',
        dayOfWeek: null,
        date: '2026-07-06',
        startMinutes: null,
        endMinutes: null,
        isOff: true,
      },
    ]);

    const data = await expectResult(
      listShifts(mockDb as never, { organizationId: 'org_1', from, to })
    ).toSucceedWith();

    expect(data[0].isOff).toBe(true);
    expect(data[0].intervals).toEqual([]);
  });

  it('returns VALIDATION_ERROR for an oversized range', async () => {
    await expectResult(
      listShifts(mockDb as never, {
        organizationId: 'org_1',
        from,
        to: new Date(2028, 6, 6),
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.where.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      listShifts(mockDb as never, { organizationId: 'org_1', from, to })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
