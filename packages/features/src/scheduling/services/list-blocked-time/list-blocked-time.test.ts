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
import { listBlockedTime } from './list-blocked-time.service.js';

const from = new Date('2026-07-01T00:00:00Z');
const to = new Date('2026-07-31T23:59:59Z');

const oneOffSeries = {
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

describe('listBlockedTime', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns expanded occurrences with practitioner ids', async () => {
    mockDb.where
      .mockResolvedValueOnce([oneOffSeries]) // series
      .mockResolvedValueOnce([
        { blockedTimeId: 'bt_1', practitionerId: 'prac_1' },
      ]) // joins
      .mockResolvedValueOnce([]); // exceptions

    const data = await expectResult(
      listBlockedTime(mockDb as never, { organizationId: 'org_1', from, to })
    ).toSucceedWith();

    expect(data).toHaveLength(1);
    expect(data[0].practitionerIds).toEqual(['prac_1']);
    expect(data[0].blockedTimeId).toBe('bt_1');
  });

  it('expands a recurring series into multiple occurrences', async () => {
    mockDb.where
      .mockResolvedValueOnce([
        {
          ...oneOffSeries,
          id: 'bt_r',
          rrule: 'FREQ=WEEKLY;BYDAY=MO',
          startDate: new Date('2026-07-06T12:00:00Z'), // a Monday
          endDate: new Date('2026-07-06T12:30:00Z'),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const data = await expectResult(
      listBlockedTime(mockDb as never, { organizationId: 'org_1', from, to })
    ).toSucceedWith();

    // Mondays in the window from Jul 6: 6, 13, 20, 27
    expect(data).toHaveLength(4);
    expect(data[0].originalStart).toEqual(new Date('2026-07-06T12:00:00Z'));
  });

  it('filters out targeted blocks not including the practitioner but keeps org-wide blocks', async () => {
    mockDb.where
      .mockResolvedValueOnce([oneOffSeries, { ...oneOffSeries, id: 'bt_2' }])
      .mockResolvedValueOnce([
        { blockedTimeId: 'bt_2', practitionerId: 'prac_other' },
      ])
      .mockResolvedValueOnce([]);

    const data = await expectResult(
      listBlockedTime(mockDb as never, {
        organizationId: 'org_1',
        from,
        to,
        practitionerId: 'prac_1',
      })
    ).toSucceedWith();

    // bt_1 has zero joins (org-wide, matches); bt_2 targets someone else
    expect(data).toHaveLength(1);
    expect(data[0].blockedTimeId).toBe('bt_1');
  });

  it('skips cancelled occurrences', async () => {
    mockDb.where
      .mockResolvedValueOnce([oneOffSeries])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'exc_1',
          blockedTimeId: 'bt_1',
          originalStart: oneOffSeries.startDate,
          cancelled: true,
          startDate: null,
          endDate: null,
          title: null,
          description: null,
        },
      ]);

    const data = await expectResult(
      listBlockedTime(mockDb as never, { organizationId: 'org_1', from, to })
    ).toSucceedWith();

    expect(data).toHaveLength(0);
  });

  it('returns VALIDATION_ERROR when to is before from', async () => {
    await expectResult(
      listBlockedTime(mockDb as never, {
        organizationId: 'org_1',
        from: to,
        to: from,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.where.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      listBlockedTime(mockDb as never, { organizationId: 'org_1', from, to })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
