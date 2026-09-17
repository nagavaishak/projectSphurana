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
import { predicateSql } from '../../../shared/sql-predicate.test-utils.js';
import { listAppointmentResources } from './list-appointment-resources.service.js';

const FROM = new Date('2026-06-01T00:00:00Z');
const TO = new Date('2026-06-08T00:00:00Z');

describe('listAppointmentResources', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // `_resetMocks()` clears calls but does NOT drain the `…Once` queue, and
    // this suite queues a value per test — see the note in the utilisation
    // spec. Only `mockReset()` empties it.
    mockDb.where.mockReset().mockReturnThis();
  });

  const window = (over: Record<string, unknown> = {}) => ({
    organizationId: 'org_1',
    from: FROM,
    to: TO,
    ...over,
  });

  const whereOf = () => predicateSql(mockDb.where.mock.calls[0]?.[0]);

  it('returns the allocations overlapping the window', async () => {
    mockDb.where.mockResolvedValueOnce([
      { id: 'ar_1', appointmentId: 'appt_1', resourceId: 'res_1' },
    ]);

    const data = await expectResult(
      listAppointmentResources(mockDb as never, window())
    ).toSucceedWith();

    expect(data).toHaveLength(1);
  });

  it('rejects a window that ends before it starts', async () => {
    const error = await expectResult(
      listAppointmentResources(mockDb as never, window({ from: TO, to: FROM }))
    ).toFailWith();

    expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  describe('branch scoping', () => {
    it('narrows the feed to the branch that was asked for', async () => {
      // Without this filter the rooms calendar is org-wide: a Cork day shows
      // Dublin's bookings as occupied rooms that Cork cannot free.
      mockDb.where.mockResolvedValueOnce([]);

      await listAppointmentResources(
        mockDb as never,
        window({ locationId: 'loc_1' })
      );

      expect(whereOf()).toContain('[col:location_id] = ?loc_1');
    });

    it('still includes resources that belong to no branch', async () => {
      mockDb.where.mockResolvedValueOnce([]);

      await listAppointmentResources(
        mockDb as never,
        window({ locationId: 'loc_1' })
      );

      expect(whereOf()).toContain('[col:location_id] is null');
    });

    it('stays org-wide when no branch is asked for', async () => {
      mockDb.where.mockResolvedValueOnce([]);

      await listAppointmentResources(mockDb as never, window());

      expect(whereOf()).not.toContain('[col:location_id]');
    });
  });
});
