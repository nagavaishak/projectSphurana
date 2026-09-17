import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import * as listAssetsByServiceModule from '../../../assets/services/list-assets-by-service/list-assets-by-service.service.js';
// Spy the SOURCE modules, not the feature barrels: barrel re-exports are live
// getters under Vite SSR and `vi.spyOn` cannot redefine them.
import * as listAssetsModule from '../../../assets/services/list-assets/list-assets.service.js';
import * as getOrgDefaultsModule from '../../../org-defaults/services/get-org-defaults/get-org-defaults.service.js';
import * as getServiceModule from '../../../organization-services/services/get-service/get-service.service.js';
import * as getOrganizationModule from '../../../organizations/services/get-organization/get-organization.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import * as buildOfferCardModule from '../../../videos/services/build-offer-card/build-offer-card.service.js';
import * as createVideoModule from '../../../videos/services/create-video/create-video.service.js';
import * as synthesizeDraftConfigModule from '../../../videos/services/create-video/synthesize-draft-config.js';
import * as queueVideoExportModule from '../../../videos/services/queue-video-export/queue-video-export.service.js';
import { generateVideoCandidates } from './generate-video-candidates.service.js';

// Restored `vi.spyOn`s, NOT `vi.mock`. Under `isolate: false` the worker shares
// one module graph, so a hoisted `vi.mock` of an internal module silently MISSES
// whenever some earlier file already imported the real module, and its bare
// factory poisons that module for every later file.
let mockSynthesize: MockInstance;
let mockBuildOfferCard: MockInstance;
let mockCreateVideo: MockInstance;
let mockQueueVideoExport: MockInstance;
let mockListAssets: MockInstance;
let mockListAssetsByService: MockInstance;
let mockGetOrgDefaults: MockInstance;
let mockGetOrganization: MockInstance;
let mockGetService: MockInstance;

const queryFns = {
  onboardingSession: { findFirst: vi.fn() },
  video: { findMany: vi.fn() },
};
const whereMock = vi.fn().mockResolvedValue([]);
const setMock = vi.fn().mockReturnValue({ where: whereMock });
const mockDb = {
  query: queryFns,
  update: vi.fn().mockReturnValue({ set: setMock }),
};

const baseSession = {
  id: 'sess_1',
  userId: 'user_1',
  organizationId: 'org_1',
  selectedServiceId: 'svc_1',
  offerId: 'offer_1',
  videoCandidateIds: null,
};

const freshSynth = () => ({
  draftConfig: {
    scriptText: '[PAIN POINT] template',
    narrationType: 'recorded' as const,
    bRollClips: [],
    captions: {
      enabled: true,
      position: 'bottom' as const,
      fontFamily: 'Inter',
      fontSize: 42,
      textColor: '#fff',
      highlightColor: '#ff0',
      backgroundColor: '#000',
      showBackground: true,
    },
    musicVolume: 0.4,
    orientation: 'portrait' as const,
  },
  templateId: 'offer',
  variationId: 'offer-square-1',
  title: 'Microneedling Offer',
});

describe('generateVideoCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryFns.onboardingSession.findFirst.mockResolvedValue(baseSession);
    queryFns.video.findMany.mockResolvedValue([]);
    mockGetOrgDefaults = vi
      .spyOn(getOrgDefaultsModule, 'getOrgDefaults')
      .mockResolvedValue({
        success: true,
        data: { videoOrientation: 'portrait' },
      } as never);
    mockGetService = vi
      .spyOn(getServiceModule, 'getService')
      .mockResolvedValue({
        success: true,
        data: { id: 'svc_1', name: 'Microneedling', description: 'Skin' },
      } as never);
    mockGetOrganization = vi
      .spyOn(getOrganizationModule, 'getOrganization')
      .mockResolvedValue({
        success: true,
        data: { name: 'Glow Clinic', logo: null },
      } as never);
    mockListAssetsByService = vi
      .spyOn(listAssetsByServiceModule, 'listAssetsByService')
      .mockResolvedValue({
        success: true,
        data: [
          { id: 'a1', type: 'video' },
          { id: 'a2', type: 'image' },
        ],
      } as never);
    mockListAssets = vi
      .spyOn(listAssetsModule, 'listAssets')
      .mockResolvedValue({
        success: true,
        data: { items: [{ id: 'a3' }, { id: 'a4' }] },
      } as never);
    mockSynthesize = vi
      .spyOn(synthesizeDraftConfigModule, 'synthesizeDraftConfig')
      .mockImplementation(freshSynth as never);
    mockBuildOfferCard = vi
      .spyOn(buildOfferCardModule, 'buildOfferCard')
      .mockResolvedValue({
        success: true,
        data: {
          offerCard: { serviceName: 'Microneedling', ctaText: 'Book now' },
        },
      } as never);
    let n = 0;
    mockCreateVideo = vi
      .spyOn(createVideoModule, 'createVideo')
      .mockImplementation((async () => ({
        success: true,
        data: { id: `vid_${++n}` },
      })) as never);
    mockQueueVideoExport = vi
      .spyOn(queueVideoExportModule, 'queueVideoExport')
      .mockResolvedValue({
        success: true,
        data: { jobId: 'job_1' },
      } as never);
    setMock.mockClear();
    setMock.mockReturnValue({ where: whereMock });
  });

  afterEach(() => {
    mockGetService.mockRestore();
    mockGetOrgDefaults.mockRestore();
    mockGetOrganization.mockRestore();
    mockListAssetsByService.mockRestore();
    mockListAssets.mockRestore();
    mockSynthesize.mockRestore();
    mockBuildOfferCard.mockRestore();
    mockCreateVideo.mockRestore();
    mockQueueVideoExport.mockRestore();
  });

  it('queues 4 offer-video renders and stores their ids on the session', async () => {
    await expectResult(
      generateVideoCandidates(mockDb as never, { userId: 'user_1' })
    ).toSucceedWith((data) => {
      expect(data.videoIds).toEqual(['vid_1', 'vid_2', 'vid_3', 'vid_4']);
    });

    expect(mockBuildOfferCard).toHaveBeenCalledTimes(4);
    expect(mockCreateVideo).toHaveBeenCalledTimes(4);
    expect(mockQueueVideoExport).toHaveBeenCalledTimes(4);
    expect(setMock).toHaveBeenCalledWith({
      videoCandidateIds: ['vid_1', 'vid_2', 'vid_3', 'vid_4'],
    });

    // Offer reshape parity with the one-prompt create path.
    const firstInput = mockCreateVideo.mock.calls[0][1] as {
      draftConfig: Record<string, unknown> & {
        captions: { enabled: boolean };
        bRollClips: Array<{ assetId: string }>;
      };
      usageType: string;
      offerId: string;
      createdById: string;
      title: string;
    };
    expect(firstInput.usageType).toBe('ad');
    expect(firstInput.offerId).toBe('offer_1');
    expect(firstInput.createdById).toBe('user_1');
    expect(firstInput.draftConfig.narrationType).toBe('text_only');
    expect(firstInput.draftConfig.orientation).toBe('square');
    expect(firstInput.draftConfig.captions.enabled).toBe(false);
    expect(firstInput.draftConfig.offerCard).toBeDefined();
    expect(firstInput.draftConfig.bRollClips.length).toBeGreaterThan(0);

    // Footage rotates between candidates so the grid varies.
    const secondInput = mockCreateVideo.mock.calls[1][1] as typeof firstInput;
    expect(secondInput.draftConfig.bRollClips[0].assetId).not.toBe(
      firstInput.draftConfig.bRollClips[0].assetId
    );
  });

  it('returns the existing candidate set when all candidates are healthy', async () => {
    queryFns.onboardingSession.findFirst.mockResolvedValue({
      ...baseSession,
      videoCandidateIds: ['v1', 'v2'],
    });
    queryFns.video.findMany.mockResolvedValue([
      { id: 'v1', status: 'completed' },
      { id: 'v2', status: 'processing' },
    ]);

    await expectResult(
      generateVideoCandidates(mockDb as never, { userId: 'user_1' })
    ).toSucceedWith((data) => {
      expect(data.videoIds).toEqual(['v1', 'v2']);
    });
    expect(mockCreateVideo).not.toHaveBeenCalled();
    expect(mockQueueVideoExport).not.toHaveBeenCalled();
  });

  it('returns CONFLICT when the intro offer has not been accepted yet', async () => {
    queryFns.onboardingSession.findFirst.mockResolvedValue({
      ...baseSession,
      offerId: null,
    });
    await expectResult(
      generateVideoCandidates(mockDb as never, { userId: 'user_1' })
    ).toFailWithCode(ErrorCodes.CONFLICT);
    expect(mockCreateVideo).not.toHaveBeenCalled();
  });

  it('returns CONFLICT when the session has no organization yet', async () => {
    queryFns.onboardingSession.findFirst.mockResolvedValue({
      ...baseSession,
      organizationId: null,
    });
    await expectResult(
      generateVideoCandidates(mockDb as never, { userId: 'user_1' })
    ).toFailWithCode(ErrorCodes.CONFLICT);
  });

  it('returns NOT_FOUND when there is no onboarding session', async () => {
    queryFns.onboardingSession.findFirst.mockResolvedValue(undefined);
    await expectResult(
      generateVideoCandidates(mockDb as never, { userId: 'user_1' })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('propagates a buildOfferCard failure when no candidate queued yet', async () => {
    mockBuildOfferCard.mockResolvedValue({
      success: false,
      error: { code: ErrorCodes.NOT_FOUND, message: 'Offer not found' },
    });
    await expectResult(
      generateVideoCandidates(mockDb as never, { userId: 'user_1' })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(mockCreateVideo).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for an out-of-range count', async () => {
    await expectResult(
      generateVideoCandidates(mockDb as never, { userId: 'user_1', count: 0 })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(queryFns.onboardingSession.findFirst).not.toHaveBeenCalled();
  });
});
