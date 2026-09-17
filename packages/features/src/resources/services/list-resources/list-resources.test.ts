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
import { listResources } from './list-resources.service.js';

describe('listResources', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const row = (
    id: string,
    name: string,
    sortOrder: number,
    category: { id: string; name: string; kind: string; sortOrder: number }
  ) => ({ id, name, sortOrder, categoryId: category.id, category });

  const rooms = { id: 'cat_1', name: 'Rooms', kind: 'room', sortOrder: 0 };
  const lasers = {
    id: 'cat_2',
    name: 'Lasers',
    kind: 'equipment',
    sortOrder: 1,
  };

  it('returns each resource with the category the UI groups it under', async () => {
    mockDb.query.resource.findMany.mockResolvedValueOnce([
      row('res_1', 'Room 1', 0, rooms),
    ]);

    const data = await expectResult(
      listResources(mockDb as never, { organizationId: 'org_1' })
    ).toSucceedWith();

    expect(data[0].category).toEqual({
      id: 'cat_1',
      name: 'Rooms',
      kind: 'room',
    });
  });

  it('orders by category, then resource sortOrder, then name', async () => {
    mockDb.query.resource.findMany.mockResolvedValueOnce([
      row('res_laser', 'Laser A', 0, lasers),
      row('res_b', 'Bravo', 1, rooms),
      row('res_c', 'Alpha', 1, rooms),
      row('res_a', 'Room 1', 0, rooms),
    ]);

    const data = await expectResult(
      listResources(mockDb as never, { organizationId: 'org_1' })
    ).toSucceedWith();

    expect(data.map((r) => r.id)).toEqual([
      'res_a',
      'res_c',
      'res_b',
      'res_laser',
    ]);
  });

  it('returns an empty list when the org has no resources', async () => {
    mockDb.query.resource.findMany.mockResolvedValueOnce([]);

    const data = await expectResult(
      listResources(mockDb as never, { organizationId: 'org_1' })
    ).toSucceedWith();

    expect(data).toEqual([]);
  });

  it('accepts category and location filters', async () => {
    mockDb.query.resource.findMany.mockResolvedValueOnce([
      row('res_1', 'Room 1', 0, rooms),
    ]);

    await expectResult(
      listResources(mockDb as never, {
        organizationId: 'org_1',
        categoryId: 'cat_1',
        locationId: 'loc_1',
      })
    ).toSucceedWith();

    expect(mockDb.query.resource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.anything() })
    );
  });

  it('returns VALIDATION_ERROR when organizationId is missing', async () => {
    await expectResult(
      listResources(mockDb as never, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.resource.findMany).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for an empty categoryId filter', async () => {
    await expectResult(
      listResources(mockDb as never, {
        organizationId: 'org_1',
        categoryId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.resource.findMany.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      listResources(mockDb as never, { organizationId: 'org_1' })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  describe('branch scoping', () => {
    const whereOf = () =>
      predicateSql(
        (
          mockDb.query.resource.findMany.mock.calls[0][0] as {
            where: unknown;
          }
        ).where
      );

    it('keeps location-less resources visible in every branch', async () => {
      // A trolley-mounted laser has no location of its own: it is available
      // everywhere, so it must appear in EVERY branch's list. Filtering with a
      // bare `eq()` hid exactly these rows, and an empty list reads as "nothing
      // set up yet" rather than as a bug.
      mockDb.query.resource.findMany.mockResolvedValueOnce([]);

      await listResources(mockDb as never, {
        organizationId: 'org_1',
        locationId: 'loc_1',
      });

      expect(whereOf()).toContain('[col:location_id] is null');
    });

    it('still narrows to the branch that was asked for', async () => {
      mockDb.query.resource.findMany.mockResolvedValueOnce([]);

      await listResources(mockDb as never, {
        organizationId: 'org_1',
        locationId: 'loc_1',
      });

      expect(whereOf()).toContain('[col:location_id] = ?loc_1');
    });

    it('does not filter by location when none is asked for', async () => {
      mockDb.query.resource.findMany.mockResolvedValueOnce([]);

      await listResources(mockDb as never, { organizationId: 'org_1' });

      expect(whereOf()).not.toContain('[col:location_id]');
    });
  });
});
