import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { resolveServiceStockClips } from './resolve-service-stock-clips.service.js';

// The matcher no longer calls a model: declared identity gates in SQL and
// embeddings only rank. So there is nothing to stub on the AI client, which is
// why this file imports none of it.

const deleteWhere = vi.fn().mockResolvedValue(undefined);
const insertValues = vi.fn().mockResolvedValue(undefined);

/**
 * Result sets handed to successive `db.select()` chains, in call order:
 *   [0] the technique-gated query — not run at all when the service has none
 *   [1] the ambient fallback
 */
let selectResults: Array<Array<{ id: string; score: number }>> = [];

const makeSelectChain = () => {
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'innerJoin', 'where', 'orderBy']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? []));
  return chain;
};

const mockDb = {
  query: {
    organizationService: { findFirst: vi.fn() },
    serviceStockClip: { findMany: vi.fn() },
  },
  select: vi.fn(() => makeSelectChain()),
  delete: vi.fn(() => ({ where: deleteWhere })),
  insert: vi.fn(() => ({ values: insertValues })),
};

const service = {
  id: 's1',
  techniqueSlug: 'microneedling',
  regions: ['full face'],
  expectedShot: 'microneedling pen tracked across the cheek, close-up',
  expectedShotEmbedding: [0.1, 0.2, 0.3],
};

beforeEach(() => {
  vi.clearAllMocks();
  selectResults = [];
  mockDb.query.organizationService.findFirst.mockResolvedValue(service);
  mockDb.query.serviceStockClip.findMany.mockResolvedValue([]);
});

describe('resolveServiceStockClips', () => {
  it('returns NOT_FOUND when the service does not exist', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValue(undefined);

    const result = await resolveServiceStockClips(mockDb as never, {
      organizationServiceId: 'missing',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('admits clips at technique grade and persists them ranked', async () => {
    selectResults = [
      [
        { id: 'c0', score: 0.82 },
        { id: 'c1', score: 0.71 },
      ],
    ];

    const result = await resolveServiceStockClips(mockDb as never, {
      organizationServiceId: 's1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.grade).toBe('technique');
    expect(result.data.picks).toEqual([
      { stockClipId: 'c0', rank: 0, score: 0.82 },
      { stockClipId: 'c1', rank: 1, score: 0.71 },
    ]);
    expect(insertValues).toHaveBeenCalledWith([
      {
        organizationServiceId: 's1',
        stockClipId: 'c0',
        rank: 0,
        score: 0.82,
        isPinned: false,
      },
      {
        organizationServiceId: 's1',
        stockClipId: 'c1',
        rank: 1,
        score: 0.71,
        isPinned: false,
      },
    ]);
  });

  it('falls back to ambient when the technique gate admits nothing', async () => {
    selectResults = [[], [{ id: 'amb0', score: 0.4 }]];

    const result = await resolveServiceStockClips(mockDb as never, {
      organizationServiceId: 's1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.grade).toBe('ambient');
    expect(result.data.picks).toHaveLength(1);
  });

  it('goes straight to ambient for a service with no declared technique', async () => {
    // A name like "Body Contouring" or "Barrier Repair" carries no treatment
    // information. Guessing one is the failure the design exists to prevent, so
    // the technique query must not run at all.
    mockDb.query.organizationService.findFirst.mockResolvedValue({
      ...service,
      techniqueSlug: null,
    });
    selectResults = [[{ id: 'amb0', score: 0.3 }]];

    const result = await resolveServiceStockClips(mockDb as never, {
      organizationServiceId: 's1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.grade).toBe('ambient');
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });

  it('reports no_spec when an unspecified service has no ambient pool either', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValue({
      ...service,
      techniqueSlug: null,
    });
    selectResults = [[]];

    const result = await resolveServiceStockClips(mockDb as never, {
      organizationServiceId: 's1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.grade).toBe('none');
    expect(result.data.skipped).toBe('no_spec');
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('reports no_candidates when a specified service finds nothing at all', async () => {
    selectResults = [[], []];

    const result = await resolveServiceStockClips(mockDb as never, {
      organizationServiceId: 's1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.skipped).toBe('no_candidates');
  });

  it('never re-inserts a clip already pinned for the service', async () => {
    // Pins are human decisions and outrank anything computed here.
    mockDb.query.serviceStockClip.findMany.mockResolvedValue([
      { stockClipId: 'c0' },
    ]);
    selectResults = [
      [
        { id: 'c0', score: 0.9 },
        { id: 'c1', score: 0.5 },
      ],
    ];

    const result = await resolveServiceStockClips(mockDb as never, {
      organizationServiceId: 's1',
    });

    expect(result.success).toBe(true);
    expect(insertValues).toHaveBeenCalledWith([
      {
        organizationServiceId: 's1',
        stockClipId: 'c1',
        rank: 1,
        score: 0.5,
        isPinned: false,
      },
    ]);
  });

  it('clears stale non-pinned rows before inserting', async () => {
    selectResults = [[{ id: 'c0', score: 0.6 }]];

    await resolveServiceStockClips(mockDb as never, {
      organizationServiceId: 's1',
    });

    // Staleness is what put laser footage on a body-contouring video: rows
    // written by the previous matcher outlived it.
    expect(mockDb.delete).toHaveBeenCalled();
    expect(deleteWhere).toHaveBeenCalled();
  });

  it('still gates when the service has no embedding to rank by', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValue({
      ...service,
      expectedShotEmbedding: null,
    });
    selectResults = [[{ id: 'c0', score: 0 }]];

    const result = await resolveServiceStockClips(mockDb as never, {
      organizationServiceId: 's1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    // An unranked legal clip beats a ranked illegal one.
    expect(result.data.grade).toBe('technique');
    expect(result.data.picks[0].stockClipId).toBe('c0');
  });
});
