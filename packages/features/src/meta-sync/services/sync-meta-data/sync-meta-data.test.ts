import * as dbModule from '@borradh-workspace/database';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import * as ensureCampaignConfigModule from '../../../meta-ads/services/ensure-campaign-config/ensure-campaign-config.service.js';
import * as importMetaAdsModule from '../../../meta-ads/services/import-meta-ads/import-meta-ads.service.js';
import * as syncAllAdsModule from '../../../meta-ads/services/sync-all-ads/sync-all-ads.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import { syncMetaData } from './sync-meta-data.service.js';

// syncAllAds / importMetaAds / backfillCampaignConfigs (its own unit — see
// ensure-campaign-config.test) are stubbed with restored `vi.spyOn`, NOT
// `vi.mock`. Under `isolate: false` all files in a worker share one module
// graph, so a hoisted bare-factory mock leaks outward (deleting every export it
// omits) and silently misses whenever an earlier file already imported the real
// module. The service imports through `index.js` barrels, whose live getters
// cannot be redefined, so we spy the SOURCE modules the barrels forward to.
let mockSyncAllAds: MockInstance;
let mockImportMetaAds: MockInstance;
let mockBackfillCampaignConfigs: MockInstance;

/**
 * The global database mock stubs `withDbRetry` as a passthrough so unit tests
 * never sleep. To assert the service genuinely *retries* the `lastSyncAt`
 * write that runs after the slow Meta sync, we install a faithful retry on the
 * mock module for one test (restored in `afterEach`, so nothing leaks under the
 * shared module graph). It retries the same transient-connection errors the
 * real `withDbRetry` does — matched by `code` or by message (postgres.js's
 * null-`write` error carries no code) — and rethrows everything else, no delay.
 */
const TRANSIENT_CODES = new Set([
  'CONNECTION_CLOSED',
  'ECONNRESET',
  'ETIMEDOUT',
  '57P01',
  '08006',
]);
const TRANSIENT_MESSAGE = /cannot read properties of null \(reading 'write'\)/i;
const isTransient = (error: unknown): boolean => {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string' && TRANSIENT_CODES.has(code)) return true;
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' && TRANSIENT_MESSAGE.test(message);
};
let retrySpy: ReturnType<typeof vi.spyOn> | undefined;
const installRealRetry = () => {
  retrySpy = vi
    .spyOn(dbModule, 'withDbRetry')
    .mockImplementation(async (fn) => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await fn();
        } catch (error) {
          if (attempt >= 3 || !isTransient(error)) throw error;
        }
      }
    });
};

const _mockUpdate = vi.fn().mockReturnThis();
const mockSet = vi.fn().mockReturnThis();
const mockWhere = vi.fn().mockResolvedValue(undefined);

const mockDb = {
  query: {
    metaAdsIntegration: {
      findFirst: vi.fn(),
    },
  },
  update: vi.fn().mockReturnValue({
    set: mockSet.mockReturnValue({
      where: mockWhere,
    }),
  }),
} as never;

describe('syncMetaData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Matches the old bare `vi.fn()`s: no default return; tests drive them.
    mockSyncAllAds = vi
      .spyOn(syncAllAdsModule, 'syncAllAds')
      .mockReturnValue(undefined as never);
    mockImportMetaAds = vi
      .spyOn(importMetaAdsModule, 'importMetaAds')
      .mockReturnValue(undefined as never);
    mockBackfillCampaignConfigs = vi.spyOn(
      ensureCampaignConfigModule,
      'backfillCampaignConfigs'
    );
    // Backfill of imported-campaign configs is a separate unit; default it to a
    // benign success so it never touches the DB in these tests.
    mockBackfillCampaignConfigs.mockResolvedValue({
      success: true,
      data: { scanned: 0, created: 0 },
    });
    // Reset chained mocks
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    (mockDb as any).update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
  });

  afterEach(() => {
    // Restore ONLY the `withDbRetry` spy (back to the global passthrough) so the
    // real-retry implementation installed by the retry tests can't leak into
    // other files under the shared module graph.
    retrySpy?.mockRestore();
    retrySpy = undefined;
    mockSyncAllAds.mockRestore();
    mockImportMetaAds.mockRestore();
    mockBackfillCampaignConfigs.mockRestore();
  });

  /** Wire `db.update().set().where()` to resolve via a controllable `where`. */
  const setLastSyncWriteMock = (where: ReturnType<typeof vi.fn>) => {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    (mockDb as any).update.mockReturnValue({
      set: vi.fn().mockReturnValue({ where }),
    });
    return where;
  };

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      syncMetaData(mockDb, {
        organizationId: '',
        userId: 'user-1',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for missing userId', async () => {
    await expectResult(
      syncMetaData(mockDb, {
        organizationId: 'org-1',
        userId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('skips sync when within throttle window', async () => {
    const recentSync = new Date(Date.now() - 60 * 1000); // 1 minute ago
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    (mockDb as any).query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      lastSyncAt: recentSync,
    });

    const result = await syncMetaData(mockDb, {
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skipped).toBe(true);
      expect(result.data.ads.created).toBe(0);
      expect(result.data.ads.updated).toBe(0);
    }
    expect(mockSyncAllAds).not.toHaveBeenCalled();
  });

  it('skips sync when the integration token needs reconnect', async () => {
    const oldSync = new Date(Date.now() - 10 * 60 * 1000); // outside throttle
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    (mockDb as any).query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      lastSyncAt: oldSync,
      tokenStatus: 'needs_reconnect',
    });

    const result = await syncMetaData(mockDb, {
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skipped).toBe(true);
      expect(result.data.lastSyncAt).toBe(oldSync.toISOString());
    }
    // Dead token: no Meta calls at all.
    expect(mockSyncAllAds).not.toHaveBeenCalled();
    expect(mockImportMetaAds).not.toHaveBeenCalled();
  });

  it('force sync still attempts even when token needs reconnect', async () => {
    mockSyncAllAds.mockResolvedValueOnce({
      success: true,
      data: { created: 0, updated: 0, deleted: 0 },
    } as never);
    mockImportMetaAds.mockResolvedValueOnce({
      success: true,
      data: { imported: 0 },
    } as never);

    const result = await syncMetaData(mockDb, {
      organizationId: 'org-1',
      userId: 'user-1',
      force: true,
    });

    expect(result.success).toBe(true);
    // force never consults the integration row, so a stale needs_reconnect
    // flag can never block a user-initiated retry.
    expect(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (mockDb as any).query.metaAdsIntegration.findFirst
    ).not.toHaveBeenCalled();
    expect(mockSyncAllAds).toHaveBeenCalled();
  });

  it('proceeds with sync when outside throttle window', async () => {
    const oldSync = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    (mockDb as any).query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      lastSyncAt: oldSync,
    });

    mockSyncAllAds.mockResolvedValueOnce({
      success: true,
      data: { created: 2, updated: 1, deleted: 0 },
    } as never);

    mockImportMetaAds.mockResolvedValueOnce({
      success: true,
      data: { imported: 0 },
    } as never);

    const result = await syncMetaData(mockDb, {
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skipped).toBe(false);
      expect(result.data.ads.created).toBe(2);
      expect(result.data.ads.updated).toBe(1);
    }
  });

  it('bypasses throttle when force is true', async () => {
    mockSyncAllAds.mockResolvedValueOnce({
      success: true,
      data: { created: 0, updated: 0, deleted: 0 },
    } as never);

    mockImportMetaAds.mockResolvedValueOnce({
      success: true,
      data: { imported: 0 },
    } as never);

    const result = await syncMetaData(mockDb, {
      organizationId: 'org-1',
      userId: 'user-1',
      force: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skipped).toBe(false);
    }
    // Should not check integration for throttle
    expect(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (mockDb as any).query.metaAdsIntegration.findFirst
    ).not.toHaveBeenCalled();
  });

  it('propagates error from syncAllAds', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    (mockDb as any).query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      null
    );

    mockSyncAllAds.mockResolvedValueOnce({
      success: false,
      error: { code: 'META_NOT_CONFIGURED', message: 'Not configured' },
    } as never);

    const result = await syncMetaData(mockDb, {
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(result.success).toBe(false);
  });

  it('syncs when no integration record exists (no throttle)', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    (mockDb as any).query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      null
    );

    mockSyncAllAds.mockResolvedValueOnce({
      success: true,
      data: { created: 1, updated: 0, deleted: 0 },
    } as never);

    mockImportMetaAds.mockResolvedValueOnce({
      success: true,
      data: { imported: 0 },
    } as never);

    const result = await syncMetaData(mockDb, {
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skipped).toBe(false);
      expect(result.data.ads.created).toBe(1);
    }
  });

  it('retries the lastSyncAt write on a transient connection error, then succeeds', async () => {
    installRealRetry();

    // The lastSyncAt update runs AFTER the slow ad sync above, during which the
    // idle pooled connection may have been severed by Fly's NAT. The first write
    // dies with postgres.js's null-`write` error, then the retry succeeds.
    const where = setLastSyncWriteMock(
      vi
        .fn()
        .mockRejectedValueOnce(
          new TypeError("Cannot read properties of null (reading 'write')")
        )
        .mockResolvedValue(undefined)
    );

    // biome-ignore lint/suspicious/noExplicitAny: test mock
    (mockDb as any).query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      null
    );
    mockSyncAllAds.mockResolvedValueOnce({
      success: true,
      data: { created: 0, updated: 1, deleted: 0 },
    } as never);
    mockImportMetaAds.mockResolvedValueOnce({
      success: true,
      data: { imported: 0 },
    } as never);

    const result = await syncMetaData(mockDb, {
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skipped).toBe(false);
      expect(result.data.ads.updated).toBe(1);
    }
    // First write threw, retry replayed it — so the write was issued twice.
    expect(where).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a non-transient lastSyncAt write error (propagates)', async () => {
    installRealRetry();

    // A non-connection error must NOT be retried — withDbRetry rethrows it on
    // the first failure and the production code does not catch the lastSyncAt
    // write, so it propagates unchanged (rather than being masked by a retry).
    const writeError = new Error('some unexpected db error');
    const where = setLastSyncWriteMock(vi.fn().mockRejectedValue(writeError));

    // biome-ignore lint/suspicious/noExplicitAny: test mock
    (mockDb as any).query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      null
    );
    mockSyncAllAds.mockResolvedValueOnce({
      success: true,
      data: { created: 0, updated: 0, deleted: 0 },
    } as never);
    mockImportMetaAds.mockResolvedValueOnce({
      success: true,
      data: { imported: 0 },
    } as never);

    await expect(
      syncMetaData(mockDb, { organizationId: 'org-1', userId: 'user-1' })
    ).rejects.toThrow('some unexpected db error');

    // Exactly one write attempt — the non-transient error was not replayed.
    expect(where).toHaveBeenCalledTimes(1);
  });
});
