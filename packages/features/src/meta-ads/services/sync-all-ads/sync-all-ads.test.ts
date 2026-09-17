import * as dbModule from '@borradh-workspace/database';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { mockMetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { CampaignErrorCodes } from '../../../meta-campaigns/models/index.js';
import { ErrorCodes } from '../../../shared/index.js';
import { syncAllAds } from './sync-all-ads.service.js';

const mockListAllAds = vi.mocked(mockMetaAdsService.listAllAds);

/**
 * The global database mock stubs `withDbRetry` as a passthrough (`(fn) => fn()`)
 * so unit tests never sleep. To assert the service genuinely *retries* its
 * post-Meta DB block, we install a faithful retry implementation on the mock
 * module for one test (restored in `afterEach`, so nothing leaks under the
 * shared module graph). It retries the same transient-connection errors the
 * real `withDbRetry` does — matched by `code` or by message (postgres.js's
 * null-`write` error carries no code) — and rethrows everything else
 * immediately, with no backoff.
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

describe('syncAllAds', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // `vi.clearAllMocks()` and `_resetMocks()` only `mockClear()` — they wipe
    // call history but keep BOTH the persistent implementation and any
    // unconsumed `mock*Once` queue. The retry tests below install a persistent
    // `mockDb.where.mockRejectedValue(...)` (and `metaAd.findMany`
    // `mockResolvedValue`), which then poisoned whichever test happened to run
    // next — this file failed under `--sequence.shuffle`. Fully reset the mocks
    // these tests program and restore the chainable default.
    mockDb.where.mockReset().mockReturnThis();
    mockDb.set.mockReset().mockReturnThis();
    mockDb.update.mockReset().mockReturnThis();
    // `mockReset()` also drops `createMockDatabase`'s defaults — reinstate them.
    mockDb.query.metaAd.findMany.mockReset().mockResolvedValue([]);
    mockDb.query.metaAdsIntegration.findFirst
      .mockReset()
      .mockResolvedValue(null);
    mockListAllAds.mockReset();
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'mock_token',
    });
  });

  afterEach(() => {
    // Restore ONLY the `withDbRetry` spy (back to the global passthrough) so the
    // real-retry implementation installed by the retry tests can't leak into
    // other files under the shared module graph. Scoped to this one spy so the
    // module-level integration mocks (decryptCredentials, listAllAds) survive.
    retrySpy?.mockRestore();
    retrySpy = undefined;
  });

  const validInput = { organizationId: 'org_123' };

  /** Integration row that passes credential resolution. */
  const configuredIntegration = {
    id: 'int_1',
    encryptedCredentials: 'enc',
    adAccountId: 'act_123',
    defaultPage: {
      id: 'dp1',
      pageId: 'p1',
      pageName: 'Page',
      linkedInstagramAccountId: null,
      linkedInstagramUsername: null,
    },
    pages: [
      {
        id: 'dp1',
        pageId: 'p1',
        pageName: 'Page',
        linkedInstagramAccountId: null,
        linkedInstagramUsername: null,
      },
    ],
    availableAdAccounts: null,
  };

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      syncAllAds(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns META_NOT_CONFIGURED when integration missing', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);
    await expectResult(syncAllAds(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(CampaignErrorCodes.META_NOT_CONFIGURED);
      }
    );
  });

  it('returns META_NOT_CONFIGURED when no adAccountId', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'int_1',
      encryptedCredentials: 'enc',
      adAccountId: null,
      defaultPage: { pageId: 'p1', pageName: 'Page' },
    });
    await expectResult(syncAllAds(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(CampaignErrorCodes.META_NOT_CONFIGURED);
      }
    );
  });

  it('returns { created: 0, updated: 0 } when no Meta ads exist', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'int_1',
      encryptedCredentials: 'enc',
      adAccountId: 'act_123',
      defaultPage: {
        id: 'dp1',
        pageId: 'p1',
        pageName: 'Page',
        linkedInstagramAccountId: null,
        linkedInstagramUsername: null,
      },
      pages: [
        {
          id: 'dp1',
          pageId: 'p1',
          pageName: 'Page',
          linkedInstagramAccountId: null,
          linkedInstagramUsername: null,
        },
      ],
      availableAdAccounts: null,
    });
    mockListAllAds.mockResolvedValueOnce([]);
    const result = await syncAllAds(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(0);
      expect(result.data.updated).toBe(0);
    }
  });

  it('updates local ads matching Meta ads', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'int_1',
      encryptedCredentials: 'enc',
      adAccountId: 'act_123',
      defaultPage: {
        id: 'dp1',
        pageId: 'p1',
        pageName: 'Page',
        linkedInstagramAccountId: null,
        linkedInstagramUsername: null,
      },
      pages: [
        {
          id: 'dp1',
          pageId: 'p1',
          pageName: 'Page',
          linkedInstagramAccountId: null,
          linkedInstagramUsername: null,
        },
      ],
      availableAdAccounts: null,
    });
    mockListAllAds.mockResolvedValueOnce([
      { id: 'meta_ad_1', effectiveStatus: 'ACTIVE', name: 'Ad 1' },
    ]);
    mockDb.query.metaAd.findMany.mockResolvedValueOnce([
      { id: 'local_1', metaAdId: 'meta_ad_1', organizationId: 'org_123' },
    ]);
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValue(undefined);

    const result = await syncAllAds(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updated).toBe(1);
      expect(result.data.created).toBe(0);
    }
  });

  it('retries the post-Meta write on a transient connection error, then succeeds', async () => {
    installRealRetry();
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      configuredIntegration
    );
    mockListAllAds.mockResolvedValueOnce([
      { id: 'meta_ad_1', effectiveStatus: 'ACTIVE', name: 'Ad 1' },
    ]);
    mockDb.query.metaAd.findMany.mockResolvedValue([
      { id: 'local_1', metaAdId: 'meta_ad_1', organizationId: 'org_123' },
    ]);
    mockDb.set.mockReturnThis();

    // The first update write dies with postgres.js's severed-socket null-write
    // error (Fly NAT killed the idle pooled connection while listAllAds ran),
    // then the retry on a fresh connection succeeds.
    mockDb.where
      .mockRejectedValueOnce(
        new TypeError("Cannot read properties of null (reading 'write')")
      )
      .mockResolvedValue(undefined);

    const result = await syncAllAds(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updated).toBe(1);
    }
    // First attempt threw on the write; the retry replayed the whole block,
    // so the update write was issued at least twice.
    expect(mockDb.where.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT retry a non-transient write error (surfaces as a failure)', async () => {
    installRealRetry();
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      configuredIntegration
    );
    mockListAllAds.mockResolvedValueOnce([
      { id: 'meta_ad_1', effectiveStatus: 'ACTIVE', name: 'Ad 1' },
    ]);
    mockDb.query.metaAd.findMany.mockResolvedValue([
      { id: 'local_1', metaAdId: 'meta_ad_1', organizationId: 'org_123' },
    ]);
    mockDb.set.mockReturnThis();

    // A constraint violation is an application error, not a connection blip —
    // it must propagate on the first failure with no retry.
    mockDb.where.mockRejectedValue(new Error('duplicate key value'));

    const result = await syncAllAds(mockDb as never, validInput);

    expect(result.success).toBe(false);
    // Exactly one update write was attempted — the non-transient error was not
    // replayed on a fresh connection.
    expect(mockDb.where).toHaveBeenCalledTimes(1);
  });
});
