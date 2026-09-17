// `@borradh-workspace/storage` and `@borradh-workspace/env/api` are canonically
// aliased mocks (see vite.config.ts + src/__mocks__) — drive them with
// `vi.mocked()` rather than a file-local `vi.mock`, which would leak under
// `isolate: false`. The env mock already carries a truthy GOOGLE_GENAI_API_KEY.
import { getSignedCdnUrl, isCdnEnabled } from '@borradh-workspace/storage';
import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';

import * as assetsModule from '../../../assets/index.js';
import * as stockFootageModule from '../../../stock-footage/index.js';
import * as resolveReferenceImageUrls from '../../resolve-reference-image-urls.js';
import * as generateAiImageModule from '../generate-ai-image/index.js';
import * as verifyModule from '../verify-asset-depicts-service/index.js';

import { resolveSlotImage } from './resolve-slot-image.service.js';

describe('resolveSlotImage — AI gating', () => {
  const mockDb = createMockDatabase();

  // Internal modules must stay per-test → restored spies created in beforeEach,
  // restored in afterEach, so they never leak onto the shared worker graph.
  let generateAiImage: ReturnType<typeof vi.spyOn>;
  let resolveReferenceImageUrl: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    generateAiImage = vi.spyOn(generateAiImageModule, 'generateAiImage');
    generateAiImage.mockResolvedValue({
      success: true,
      data: { png: Buffer.from('fake-png') },
    });
    resolveReferenceImageUrl = vi.spyOn(
      resolveReferenceImageUrls,
      'resolveReferenceImageUrl'
    );
    resolveReferenceImageUrl.mockImplementation((url: string) =>
      Promise.resolve(`signed:${url}`)
    );
    // The AI path returns the CDN-signed URL when CDN is enabled.
    vi.mocked(isCdnEnabled).mockReturnValue(true);
    vi.mocked(getSignedCdnUrl).mockReturnValue('https://cdn/ai.png');
  });

  afterEach(() => {
    generateAiImage.mockRestore();
    resolveReferenceImageUrl.mockRestore();
  });

  const baseInput = {
    organizationId: 'org_1',
    targetServiceId: 'svc_1',
    prompt: 'a close-up of the treatment',
    bbox: { w: 1080, h: 1350 },
  };

  it('returns no-resolution and does NOT call AI when no service asset and allowAiImages is false', async () => {
    mockDb.orderBy.mockResolvedValueOnce([]); // service-asset lookup → none

    const result = await resolveSlotImage(mockDb as never, {
      ...baseInput,
      allowAiImages: false,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBe('no-resolution');
      expect(result.data.url).toBe('');
    }
    expect(generateAiImage).not.toHaveBeenCalled();
  });

  it('defaults to no AI when allowAiImages is omitted', async () => {
    mockDb.orderBy.mockResolvedValueOnce([]);

    const result = await resolveSlotImage(mockDb as never, baseInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.source).toBe('no-resolution');
    expect(generateAiImage).not.toHaveBeenCalled();
  });

  it('generates an AI image when no service asset and allowAiImages is true', async () => {
    mockDb.orderBy.mockResolvedValueOnce([]);

    const result = await resolveSlotImage(mockDb as never, {
      ...baseInput,
      allowAiImages: true,
    });

    expect(generateAiImage).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBe('ai-generated');
      expect(result.data.url).toBe('https://cdn/ai.png');
    }
  });

  it('uses the service image asset and never calls AI, regardless of the flag', async () => {
    mockDb.orderBy.mockResolvedValueOnce([
      {
        id: 'asset_1',
        type: 'image',
        blobUrl: 'cdn://photo.jpg',
        thumbnailUrl: null,
        capturedAt: new Date('2026-01-01'),
        createdAt: new Date('2026-01-01'),
      },
    ]);

    const result = await resolveSlotImage(mockDb as never, {
      ...baseInput,
      allowAiImages: true,
    });

    expect(generateAiImage).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBe('service-image-asset');
      expect(result.data.consumedAssetId).toBe('asset_1');
      expect(result.data.url).toBe('signed:cdn://photo.jpg');
    }
  });

  it('uses the owner-selected raw image order instead of service auto-pick', async () => {
    mockDb.where.mockResolvedValueOnce([
      {
        id: 'chosen-second',
        type: 'image',
        blobUrl: 'cdn://second.jpg',
        thumbnailUrl: null,
        capturedAt: null,
        createdAt: new Date('2026-01-02'),
      },
      {
        id: 'chosen-first',
        type: 'image',
        blobUrl: 'cdn://first.jpg',
        thumbnailUrl: null,
        capturedAt: null,
        createdAt: new Date('2026-01-01'),
      },
    ]);

    const result = await resolveSlotImage(mockDb as never, {
      ...baseInput,
      sourceAssetIds: ['chosen-first', 'chosen-second'],
      allowAiImages: false,
    });

    expect(mockDb.orderBy).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.consumedAssetId).toBe('chosen-first');
      expect(result.data.url).toBe('signed:cdn://first.jpg');
    }
  });
});

/**
 * Rotation — the fix for "graphics use the exact same image".
 *
 * Selection used to be deterministic ("newest asset, always"), so a service
 * with two eligible photos produced sixteen graphics of the same one. Usage
 * history now reorders the candidates so an asset we just used loses to one we
 * haven't.
 */
describe('resolveSlotImage — rotation by usage', () => {
  const mockDb = createMockDatabase();

  let resolveReferenceImageUrl: ReturnType<typeof vi.spyOn>;
  let claimRotatedAsset: ReturnType<typeof vi.spyOn>;
  let markAssetUsed: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    resolveReferenceImageUrl = vi.spyOn(
      resolveReferenceImageUrls,
      'resolveReferenceImageUrl'
    );
    resolveReferenceImageUrl.mockImplementation((url: string) =>
      Promise.resolve(`signed:${url}`)
    );
    claimRotatedAsset = vi.spyOn(assetsModule, 'claimRotatedAsset');
    markAssetUsed = vi.spyOn(assetsModule, 'markAssetUsed');
    markAssetUsed.mockResolvedValue(undefined);
  });

  afterEach(() => {
    resolveReferenceImageUrl.mockRestore();
    claimRotatedAsset.mockRestore();
    markAssetUsed.mockRestore();
  });

  const input = {
    organizationId: 'org_1',
    targetServiceId: 'svc_1',
    prompt: 'a treatment photo',
    bbox: { w: 1080, h: 1350 },
    allowAiImages: false,
    allowStockImages: false,
  };

  /** Two eligible photos, newest first — the order the query returns them. */
  const twoPhotos = [
    {
      id: 'photo-newest',
      type: 'image' as const,
      blobUrl: 'cdn://newest.jpg',
      thumbnailUrl: null,
      capturedAt: new Date('2026-02-01'),
      createdAt: new Date('2026-02-01'),
    },
    {
      id: 'photo-older',
      type: 'image' as const,
      blobUrl: 'cdn://older.jpg',
      thumbnailUrl: null,
      capturedAt: new Date('2026-01-01'),
      createdAt: new Date('2026-01-01'),
    },
  ];

  const claimOk = (assetId: string | null, poolSize = 2) => ({
    success: true as const,
    data: { assetId, previousUseCount: 0, poolSize, excludedForQuality: 0 },
  });

  it('uses the asset the claim handed back', async () => {
    claimRotatedAsset.mockResolvedValue(claimOk('photo-newest'));
    mockDb.orderBy.mockResolvedValueOnce(twoPhotos);

    const result = await resolveSlotImage(mockDb as never, input);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.consumedAssetId).toBe('photo-newest');
  });

  it('picks the OTHER asset once the newest has just been used', async () => {
    // The claim returns least-recently-used, so after 'photo-newest' has been
    // stamped the next generation gets 'photo-older'. Without rotation this
    // returned 'photo-newest' again, and again, for every graphic.
    claimRotatedAsset.mockResolvedValue(claimOk('photo-older'));
    mockDb.orderBy.mockResolvedValueOnce(twoPhotos);

    const result = await resolveSlotImage(mockDb as never, input);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.consumedAssetId).toBe('photo-older');
    expect(result.data.url).toBe('signed:cdn://older.jpg');
  });

  it('falls back to the default ordering when the claim fails', async () => {
    // Rotation is an improvement, never a gate — a failed claim must not stop
    // us producing content.
    claimRotatedAsset.mockResolvedValue({
      success: false as const,
      error: { code: 'INTERNAL_ERROR', message: 'db down' },
    });
    mockDb.orderBy.mockResolvedValueOnce(twoPhotos);

    const result = await resolveSlotImage(mockDb as never, input);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.consumedAssetId).toBe('photo-newest');
  });

  it('reports the candidates it considered, for provenance', async () => {
    claimRotatedAsset.mockResolvedValue(claimOk('photo-newest'));
    mockDb.orderBy.mockResolvedValueOnce(twoPhotos);

    const result = await resolveSlotImage(mockDb as never, input);

    expect(result.success).toBe(true);
    if (!result.success) return;
    // A service with one candidate must be distinguishable from one with many
    // when diagnosing "why is it always the same photo?".
    expect(result.data.candidateAssetIds).toEqual([
      'photo-newest',
      'photo-older',
    ]);
  });

  it('does not rotate an explicit owner selection', async () => {
    // sourceAssetIds is an instruction with an order, not a default.
    claimRotatedAsset.mockResolvedValue(claimOk('chosen-second'));
    mockDb.where.mockResolvedValueOnce([
      {
        id: 'chosen-first',
        type: 'image',
        blobUrl: 'cdn://first.jpg',
        thumbnailUrl: null,
        capturedAt: null,
        createdAt: new Date('2026-01-01'),
      },
      {
        id: 'chosen-second',
        type: 'image',
        blobUrl: 'cdn://second.jpg',
        thumbnailUrl: null,
        capturedAt: null,
        createdAt: new Date('2026-01-02'),
      },
    ]);

    const result = await resolveSlotImage(mockDb as never, {
      ...input,
      targetServiceId: undefined,
      sourceAssetIds: ['chosen-first', 'chosen-second'],
    });

    expect(claimRotatedAsset).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.consumedAssetId).toBe('chosen-first');
  });

  // Generating one graphic from the create-post dialog must feed the same
  // rotation memory as a batch. Rotation doesn't PICK here — the owner did —
  // but leaving it unstamped makes the photo look never-used, so the next
  // batch reaches straight for the one just published by hand.
  it('records usage when the owner picked the asset themselves', async () => {
    claimRotatedAsset.mockResolvedValue(claimOk(null));
    mockDb.where.mockResolvedValueOnce([
      {
        id: 'chosen-first',
        type: 'image',
        blobUrl: 'cdn://first.jpg',
        thumbnailUrl: null,
        capturedAt: null,
        createdAt: new Date('2026-01-01'),
      },
    ]);

    await resolveSlotImage(mockDb as never, {
      ...input,
      sourceAssetIds: ['chosen-first'],
    });

    expect(markAssetUsed).toHaveBeenCalledWith(expect.anything(), {
      serviceId: 'svc_1',
      assetId: 'chosen-first',
    });
  });

  it('does not double-stamp an asset rotation already claimed', () => {
    // The claim stamps as it picks, so stamping again would inflate use_count
    // and skew the ordering against an asset that was used once.
    claimRotatedAsset.mockResolvedValue(claimOk('photo-newest'));
    mockDb.orderBy.mockResolvedValueOnce(twoPhotos);

    return resolveSlotImage(mockDb as never, input).then(() => {
      expect(markAssetUsed).not.toHaveBeenCalled();
    });
  });
});

describe('resolveSlotImage — "no SUITABLE stock" falls back to AI', () => {
  const mockDb = createMockDatabase();

  let generateAiImage: ReturnType<typeof vi.spyOn>;
  let resolveReferenceImageUrl: ReturnType<typeof vi.spyOn>;
  let selectStockImage: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    generateAiImage = vi.spyOn(generateAiImageModule, 'generateAiImage');
    generateAiImage.mockResolvedValue({
      success: true,
      data: { png: Buffer.from('fake-png') },
    });
    resolveReferenceImageUrl = vi.spyOn(
      resolveReferenceImageUrls,
      'resolveReferenceImageUrl'
    );
    resolveReferenceImageUrl.mockImplementation((url: string) =>
      Promise.resolve(`signed:${url}`)
    );
    selectStockImage = vi.spyOn(stockFootageModule, 'selectStockImage');
    vi.mocked(isCdnEnabled).mockReturnValue(true);
    vi.mocked(getSignedCdnUrl).mockReturnValue('https://cdn/ai.png');
  });

  afterEach(() => {
    generateAiImage.mockRestore();
    resolveReferenceImageUrl.mockRestore();
    selectStockImage.mockRestore();
  });

  const noOwnAssets = () => mockDb.orderBy.mockResolvedValueOnce([]);
  const base = {
    organizationId: 'org_1',
    targetServiceId: 'svc_1',
    prompt: 'a cryotherapy facial',
    bbox: { w: 1080, h: 1350 },
    policy: 'own-then-stock-then-ai' as const,
  };

  it('uses stock the matcher actually linked to the service', async () => {
    noOwnAssets();
    selectStockImage.mockResolvedValue({
      success: true,
      data: {
        stockClipId: 'clip_1',
        url: 'cdn://facial.jpg',
        matchSource: 'service-match',
      },
    });

    const result = await resolveSlotImage(mockDb as never, base);

    expect(generateAiImage).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBe('stock-image');
      expect(result.data.imagery).toMatchObject({
        kind: 'stock',
        matchSource: 'service-match',
      });
    }
  });

  it('REJECTS an ambient-pool clip and invents instead', async () => {
    // The IV drip. The generic pool answered a cryotherapy facial with a drip,
    // a syringe and IV bags — it is region-safe, not relevant. An invented
    // image that fits beats an unrelated photograph presented as imagery.
    noOwnAssets();
    selectStockImage.mockResolvedValue({
      success: true,
      data: {
        stockClipId: 'clip_generic',
        url: 'cdn://iv-drip.jpg',
        matchSource: 'generic',
      },
    });

    const result = await resolveSlotImage(mockDb as never, base);

    expect(generateAiImage).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBe('ai-generated');
      expect(result.data.imagery.kind).toBe('ai-fill');
    }
  });

  it('still takes the ambient clip when there is no AI backstop', async () => {
    // `own-then-stock` has nothing better to fall back on, so an ambient clip
    // beats an empty photo area. The rejection above is a consequence of
    // HAVING an alternative, not a judgement that the pool is unusable.
    noOwnAssets();
    selectStockImage.mockResolvedValue({
      success: true,
      data: {
        stockClipId: 'clip_generic',
        url: 'cdn://iv-drip.jpg',
        matchSource: 'generic',
      },
    });

    const result = await resolveSlotImage(mockDb as never, {
      ...base,
      policy: 'own-then-stock',
    });

    expect(generateAiImage).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.source).toBe('stock-image');
  });

  it('prefers the org own photograph over both', async () => {
    mockDb.orderBy.mockResolvedValueOnce([
      {
        id: 'asset_1',
        type: 'image',
        blobUrl: 'cdn://real.jpg',
        thumbnailUrl: null,
        capturedAt: new Date('2026-01-01'),
        createdAt: new Date('2026-01-01'),
      },
    ]);

    const result = await resolveSlotImage(mockDb as never, base);

    expect(selectStockImage).not.toHaveBeenCalled();
    expect(generateAiImage).not.toHaveBeenCalled();
    if (result.success) expect(result.data.imagery.kind).toBe('org-asset');
  });
});

describe('resolveSlotImage — a mis-linked asset falls through', () => {
  const mockDb = createMockDatabase();

  let verify: ReturnType<typeof vi.spyOn>;
  let selectStockImage: ReturnType<typeof vi.spyOn>;
  let generateAiImage: ReturnType<typeof vi.spyOn>;
  let resolveReferenceImageUrl: ReturnType<typeof vi.spyOn>;
  let claimRotatedAsset: ReturnType<typeof vi.spyOn>;
  let markAssetUsed: ReturnType<typeof vi.spyOn>;

  const photo = {
    id: 'asset_wrong',
    type: 'image' as const,
    blobUrl: 'cdn://coffee-scrub.jpg',
    thumbnailUrl: null,
    capturedAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    verify = vi.spyOn(verifyModule, 'verifyAssetDepictsService');
    selectStockImage = vi.spyOn(stockFootageModule, 'selectStockImage');
    generateAiImage = vi.spyOn(generateAiImageModule, 'generateAiImage');
    generateAiImage.mockResolvedValue({
      success: true,
      data: { png: Buffer.from('fake-png') },
    });
    resolveReferenceImageUrl = vi.spyOn(
      resolveReferenceImageUrls,
      'resolveReferenceImageUrl'
    );
    resolveReferenceImageUrl.mockImplementation((url: string) =>
      Promise.resolve(`signed:${url}`)
    );
    claimRotatedAsset = vi.spyOn(assetsModule, 'claimRotatedAsset');
    claimRotatedAsset.mockResolvedValue({
      success: true,
      data: {
        assetId: 'asset_wrong',
        previousUseCount: 0,
        poolSize: 1,
        excludedForQuality: 0,
      },
    });
    markAssetUsed = vi.spyOn(assetsModule, 'markAssetUsed');
    markAssetUsed.mockResolvedValue(undefined);
    vi.mocked(isCdnEnabled).mockReturnValue(true);
    vi.mocked(getSignedCdnUrl).mockReturnValue('https://cdn/ai.png');
    // The depiction check reads the cached verdict, then the service, then
    // FETCHES the image. Prime all three: no cached verdict (so the judge
    // actually runs), a service to name, and bytes to look at.
    mockDb.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { name: 'Deep Steam Facial', description: null },
      ]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    verify.mockRestore();
    selectStockImage.mockRestore();
    generateAiImage.mockRestore();
    resolveReferenceImageUrl.mockRestore();
    claimRotatedAsset.mockRestore();
    markAssetUsed.mockRestore();
  });

  const base = {
    organizationId: 'org_1',
    targetServiceId: 'svc_1',
    prompt: 'a deep steam facial',
    bbox: { w: 1080, h: 1350 },
    policy: 'own-then-stock-then-ai' as const,
  };

  it('uses the org photo when the judge says it depicts the service', async () => {
    mockDb.orderBy.mockResolvedValueOnce([photo]);
    verify.mockResolvedValue({
      success: true,
      data: { depicts: true, note: 'steam facial' },
    });

    const result = await resolveSlotImage(mockDb as never, base);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.imagery.kind).toBe('org-asset');
    expect(generateAiImage).not.toHaveBeenCalled();
  });

  it('falls through to AI when the judge says it does NOT', async () => {
    // The coffee-scrub case: filed under "Deep Steam Facial" at the tagging
    // classifier's HIGHEST confidence, and a graphic built from it advertised
    // an "aromatic coffee scrub" as part of the facial. Generic beats wrong.
    mockDb.orderBy.mockResolvedValueOnce([photo]);
    verify.mockResolvedValue({
      success: true,
      data: { depicts: false, note: 'coffee scrub, not steam' },
    });
    selectStockImage.mockResolvedValue({ success: true, data: null });

    const result = await resolveSlotImage(mockDb as never, base);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imagery.kind).not.toBe('org-asset');
      expect(result.data.source).toBe('ai-generated');
    }
  });

  it('never lets the judge veto a photo the OWNER picked', async () => {
    // The bug this file is named for. An owner opened the picker, chose their
    // own facial-roller photograph, and `assetDepictsService` returned false —
    // so the slot resolved to nothing and the graphic came back with no
    // picture in it and no explanation. The judge polices the AUTOMATIC link;
    // an explicit selection is the owner telling us what their work looks
    // like, and it outranks a classifier's opinion of it.
    mockDb.where.mockResolvedValueOnce([
      {
        id: 'owner-pick',
        type: 'image',
        blobUrl: 'cdn://owner-pick.jpg',
        thumbnailUrl: null,
        capturedAt: null,
        createdAt: new Date('2026-01-01'),
      },
    ]);
    verify.mockResolvedValue({
      success: true,
      data: { depicts: false, note: 'classifier disagrees' },
    });

    const result = await resolveSlotImage(mockDb as never, {
      ...base,
      sourceAssetIds: ['owner-pick'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imagery.kind).toBe('org-asset');
      expect(result.data.consumedAssetId).toBe('owner-pick');
    }
    // Not merely overridden — never asked. The check costs a model call.
    expect(verify).not.toHaveBeenCalled();
    expect(generateAiImage).not.toHaveBeenCalled();
  });

  it('KEEPS the photo when the judge itself errors', async () => {
    // Fails open: a check that could not run is not evidence against the
    // image, and must never cost the business its own photograph.
    mockDb.orderBy.mockResolvedValueOnce([photo]);
    verify.mockResolvedValue({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'judge down' },
    });

    const result = await resolveSlotImage(mockDb as never, base);
    if (result.success) expect(result.data.imagery.kind).toBe('org-asset');
  });
});

/**
 * ENG-720. A laser-aftercare graphic came back illustrated with a gloved hand
 * holding a SYRINGE. The clip was returned by stock as a `service-match`, and
 * verification ran only on the org's own uploads, so nothing questioned it.
 */
describe('resolveSlotImage — stock must depict the service', () => {
  const mockDb = createMockDatabase();

  let generateAiImage: ReturnType<typeof vi.spyOn>;
  let resolveReferenceImageUrl: ReturnType<typeof vi.spyOn>;
  let selectStockImage: ReturnType<typeof vi.spyOn>;
  let verifyAssetDepictsService: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    generateAiImage = vi.spyOn(generateAiImageModule, 'generateAiImage');
    generateAiImage.mockResolvedValue({
      success: true,
      data: { png: Buffer.from('fake-png') },
    });
    resolveReferenceImageUrl = vi.spyOn(
      resolveReferenceImageUrls,
      'resolveReferenceImageUrl'
    );
    resolveReferenceImageUrl.mockImplementation((url: string) =>
      Promise.resolve(`signed:${url}`)
    );
    selectStockImage = vi.spyOn(stockFootageModule, 'selectStockImage');
    selectStockImage.mockResolvedValue({
      success: true,
      data: {
        stockClipId: 'clip_syringe',
        url: 'cdn://syringe.jpg',
        matchSource: 'service-match',
      },
    });
    verifyAssetDepictsService = vi.spyOn(
      verifyModule,
      'verifyAssetDepictsService'
    );
    // The service row the depiction check reads.
    mockDb.limit.mockResolvedValue([
      {
        name: 'Laser Hair Removal',
        description: 'Medium area, single session',
      },
    ]);
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    } as never);
    vi.mocked(isCdnEnabled).mockReturnValue(true);
    vi.mocked(getSignedCdnUrl).mockReturnValue('https://cdn/ai.png');
  });

  afterEach(() => {
    generateAiImage.mockRestore();
    resolveReferenceImageUrl.mockRestore();
    selectStockImage.mockRestore();
    verifyAssetDepictsService.mockRestore();
    fetchSpy.mockRestore();
  });

  const noOwnAssets = () => mockDb.orderBy.mockResolvedValueOnce([]);
  const base = {
    organizationId: 'org_1',
    targetServiceId: 'svc_1',
    prompt: 'after your laser session',
    bbox: { w: 1080, h: 1350 },
    policy: 'own-then-stock-then-ai' as const,
  };

  it('rejects a service-matched clip the check says is wrong, and invents instead', async () => {
    noOwnAssets();
    verifyAssetDepictsService.mockResolvedValue({
      success: true,
      data: { depicts: false },
    });

    const result = await resolveSlotImage(mockDb as never, base);

    expect(verifyAssetDepictsService).toHaveBeenCalled();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.source).not.toBe('stock-image');
    // Falls THROUGH to the next tier rather than returning the bad clip.
    expect(generateAiImage).toHaveBeenCalled();
  });

  it('keeps a clip the check confirms', async () => {
    noOwnAssets();
    verifyAssetDepictsService.mockResolvedValue({
      success: true,
      data: { depicts: true },
    });

    const result = await resolveSlotImage(mockDb as never, base);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.source).toBe('stock-image');
    expect(generateAiImage).not.toHaveBeenCalled();
  });

  // A check that could not run is not evidence against the photograph.
  it('keeps the clip when the image cannot be fetched', async () => {
    noOwnAssets();
    fetchSpy.mockResolvedValue({ ok: false, status: 404 } as never);

    const result = await resolveSlotImage(mockDb as never, base);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.source).toBe('stock-image');
  });

  it('keeps the clip when the verifier itself fails', async () => {
    noOwnAssets();
    verifyAssetDepictsService.mockResolvedValue({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'model down' },
    });

    const result = await resolveSlotImage(mockDb as never, base);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.source).toBe('stock-image');
  });
});
