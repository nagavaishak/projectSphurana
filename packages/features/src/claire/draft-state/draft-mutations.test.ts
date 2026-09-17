import { isAIClientInitialized } from '@borradh-workspace/ai';
import type { MetaAd } from '@borradh-workspace/database';
import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

// recommendation-engine (pulled transitively by update-draft-ad) imports the
// AI client at module-init; stub it so the suite runs offline. Mirrors
// draft-state.test.ts.

// promoteDraftAd delegates the live launch to launchAd — stub it so we test the
// draft-side readiness guards + handoff, not the Meta launch sequence. Spy the
// SOURCE module (the `launch-ad/index.js` barrel re-exports it as a live getter
// which cannot be redefined); a restored spy is load-order independent and
// cannot leak across the shared worker graph under `isolate: false`.
import * as launchAdModule from '../../meta-ads/services/launch-ad/launch-ad.service.js';

import { promoteDraftAd } from './promote-draft-ad.service.js';
import { updateDraftAd } from './update-draft-ad.service.js';

const fakeAd = (overrides: Partial<MetaAd> = {}): MetaAd =>
  ({
    id: 'draft_ad_1',
    organizationId: 'org_1',
    metaCampaignId: null,
    metaAdSetId: null,
    videoId: null,
    socialPostId: null,
    useExistingPost: false,
    name: 'Draft',
    headline: 'old headline',
    primaryText: 'old body',
    description: null,
    callToAction: 'BOOK_NOW',
    destinationUrl: null,
    isImported: false,
    status: 'draft',
    targetingOverride: null,
    followUpType: 'lead_form',
    leadFormId: null,
    sequenceId: null,
    adPlacement: 'facebook',
    conversionDestination: null,
    destinations: null,
    metaAdsPageId: null,
    adAccountId: null,
    metaAdId: null,
    metaCreativeId: null,
    metaVideoId: null,
    metaImageHash: null,
    metaStatus: null,
    lastSyncAt: null,
    syncError: null,
    metaThumbnailUrl: null,
    metaPermalink: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as MetaAd;

/**
 * Mock db for updateDraftAd's non-cascade path. Captures the `.set(...)`
 * payload so we can assert exactly which columns were written, and records
 * junction delete/insert calls.
 */
const buildAdUpdateMockDb = (params: {
  existing: MetaAd | null;
  updated: MetaAd;
  junctionRows?: { serviceId: string }[];
}) => {
  const setPayloads: Record<string, unknown>[] = [];
  const insertValues: { metaAdId: string; serviceId: string }[][] = [];

  const returning = vi.fn().mockResolvedValue([params.updated]);
  const updateWhere = vi.fn().mockReturnValue({ returning });
  const set = vi.fn((payload: Record<string, unknown>) => {
    setPayloads.push(payload);
    return { where: updateWhere };
  });

  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const insertValuesFn = vi.fn(
    (rows: { metaAdId: string; serviceId: string }[]) => {
      insertValues.push(rows);
      return Promise.resolve(undefined);
    }
  );

  const selectWhere = vi.fn().mockResolvedValue(params.junctionRows ?? []);

  const db = {
    query: {
      metaAd: { findFirst: vi.fn().mockResolvedValue(params.existing) },
    },
    update: vi.fn().mockReturnValue({ set }),
    delete: vi.fn().mockReturnValue({ where: deleteWhere }),
    insert: vi.fn().mockReturnValue({ values: insertValuesFn }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: selectWhere }),
    }),
  };

  return { db, setPayloads, insertValues, deleteWhere };
};

// `@borradh-workspace/ai` is canonically mocked (vite.config.ts alias). These
// tests exercise the no-API-key static path, so force `isAIClientInitialized`
// false here and restore the canonical `true` after, to avoid leaking the
// override across the shared worker graph under `isolate: false`. See
// docs/plans/features-test-suite-speedup.md.
beforeEach(() => {
  vi.mocked(isAIClientInitialized).mockReturnValue(false);
});
afterEach(() => {
  vi.mocked(isAIClientInitialized).mockReturnValue(true);
});

describe('updateDraftAd', () => {
  beforeEach(() => vi.clearAllMocks());

  it('applies a scalar update verbatim and keeps existing junction services', async () => {
    const existing = fakeAd();
    const updated = fakeAd({ headline: 'New headline' });
    const { db, setPayloads, deleteWhere } = buildAdUpdateMockDb({
      existing,
      updated,
      junctionRows: [{ serviceId: 'svc_1' }],
    });

    const result = await updateDraftAd(db as never, {
      organizationId: 'org_1',
      draftId: 'draft_ad_1',
      update: { headline: 'New headline' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ad.headline).toBe('New headline');
      // No serviceIds in the update → junction untouched, existing ids read back.
      expect(result.data.serviceIds).toEqual(['svc_1']);
    }
    // The headline was written verbatim (no cascade clobber).
    expect(setPayloads[0]?.headline).toBe('New headline');
    // serviceIds absent → junction not rewritten.
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it('replaces the junction table when serviceIds are provided', async () => {
    const existing = fakeAd();
    const { db, insertValues, deleteWhere } = buildAdUpdateMockDb({
      existing,
      updated: fakeAd(),
    });

    const result = await updateDraftAd(db as never, {
      organizationId: 'org_1',
      draftId: 'draft_ad_1',
      update: { serviceIds: ['svc_2', 'svc_3'] },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.serviceIds).toEqual(['svc_2', 'svc_3']);
    }
    // Old links cleared, new ones inserted.
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(insertValues[0]).toEqual([
      { metaAdId: 'draft_ad_1', serviceId: 'svc_2' },
      { metaAdId: 'draft_ad_1', serviceId: 'svc_3' },
    ]);
  });

  it('returns NOT_FOUND when the draft does not exist', async () => {
    const { db } = buildAdUpdateMockDb({ existing: null, updated: fakeAd() });
    const result = await updateDraftAd(db as never, {
      organizationId: 'org_1',
      draftId: 'missing',
      update: { headline: 'x' },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('refuses to edit an ad that has already been promoted (INVALID_STATE)', async () => {
    const { db } = buildAdUpdateMockDb({
      existing: fakeAd({ status: 'launching' }),
      updated: fakeAd(),
    });
    const result = await updateDraftAd(db as never, {
      organizationId: 'org_1',
      draftId: 'draft_ad_1',
      update: { headline: 'x' },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_STATE');
  });
});

/** Mock db for promoteDraftAd: a draft lookup + a junction select. */
const buildPromoteMockDb = (params: {
  draft: MetaAd | null;
  junctionRows?: { serviceId: string }[];
}) => {
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const db = {
    query: { metaAd: { findFirst: vi.fn().mockResolvedValue(params.draft) } },
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(params.junctionRows ?? []),
      }),
    }),
    delete: vi.fn().mockReturnValue({ where: deleteWhere }),
  };
  return { db, deleteWhere };
};

const launchReady = (): Partial<MetaAd> => ({
  metaCampaignId: 'camp_1',
  videoId: 'vid_1',
  targetingOverride: { countries: ['IE'] } as never,
});

describe('promoteDraftAd — publish-readiness guards', () => {
  let mockLaunchAd: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLaunchAd = (
      vi.spyOn(launchAdModule, 'launchAd') as unknown as MockInstance
    ).mockReturnValue(undefined);
  });

  afterEach(() => {
    mockLaunchAd.mockRestore();
  });

  it('returns NOT_FOUND when the draft is missing', async () => {
    const { db } = buildPromoteMockDb({ draft: null });
    const result = await promoteDraftAd(db as never, {
      organizationId: 'org_1',
      draftId: 'missing',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('refuses to promote an already-promoted draft', async () => {
    const { db } = buildPromoteMockDb({
      draft: fakeAd({ ...launchReady(), status: 'launching' }),
    });
    const result = await promoteDraftAd(db as never, {
      organizationId: 'org_1',
      draftId: 'draft_ad_1',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_STATE');
  });

  it('refuses when the campaign is not set', async () => {
    const { db } = buildPromoteMockDb({
      draft: fakeAd({ videoId: 'vid_1', targetingOverride: {} as never }),
    });
    const result = await promoteDraftAd(db as never, {
      organizationId: 'org_1',
      draftId: 'draft_ad_1',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_STATE');
  });

  it('refuses when the creative (videoId) is not set', async () => {
    const { db } = buildPromoteMockDb({
      draft: fakeAd({
        metaCampaignId: 'camp_1',
        targetingOverride: {} as never,
      }),
    });
    const result = await promoteDraftAd(db as never, {
      organizationId: 'org_1',
      draftId: 'draft_ad_1',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_STATE');
  });

  it('refuses when targeting is not set', async () => {
    const { db } = buildPromoteMockDb({
      draft: fakeAd({ metaCampaignId: 'camp_1', videoId: 'vid_1' }),
    });
    const result = await promoteDraftAd(db as never, {
      organizationId: 'org_1',
      draftId: 'draft_ad_1',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_STATE');
  });

  it('refuses when no services are linked', async () => {
    const { db } = buildPromoteMockDb({
      draft: fakeAd(launchReady()),
      junctionRows: [],
    });
    const result = await promoteDraftAd(db as never, {
      organizationId: 'org_1',
      draftId: 'draft_ad_1',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_STATE');
  });

  it('launches and deletes the draft when everything is ready', async () => {
    const { db, deleteWhere } = buildPromoteMockDb({
      draft: fakeAd(launchReady()),
      junctionRows: [{ serviceId: 'svc_1' }],
    });
    mockLaunchAd.mockResolvedValue({
      success: true,
      data: { ad: fakeAd(), metaCampaignId: 'camp_1', metaAdSetId: 'set_1' },
    });

    const result = await promoteDraftAd(db as never, {
      organizationId: 'org_1',
      draftId: 'draft_ad_1',
    });

    expect(mockLaunchAd).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    // Draft row removed after a successful launch.
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });

  it('leaves the draft intact when launchAd fails', async () => {
    const { db, deleteWhere } = buildPromoteMockDb({
      draft: fakeAd(launchReady()),
      junctionRows: [{ serviceId: 'svc_1' }],
    });
    mockLaunchAd.mockResolvedValue({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Meta rejected' },
    });

    const result = await promoteDraftAd(db as never, {
      organizationId: 'org_1',
      draftId: 'draft_ad_1',
    });

    expect(result.success).toBe(false);
    // Draft NOT deleted — operator can fix and retry.
    expect(deleteWhere).not.toHaveBeenCalled();
  });
});
