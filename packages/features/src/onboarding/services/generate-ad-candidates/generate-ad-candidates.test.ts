import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
// Spy the SOURCE modules, not the organization-services / graphics barrels: the
// barrels' re-exports are live getters under Vite SSR and cannot be redefined.
import * as generateGraphicFromServiceModule from '../../../graphics/services/generate-graphic-from-service/generate-graphic-from-service.service.js';
import * as getServiceModule from '../../../organization-services/services/get-service/get-service.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import { generateAdCandidates } from './generate-ad-candidates.service.js';

let mockGenerate: MockInstance;
let mockGetService: MockInstance;

const queryFns = {
  onboardingSession: { findFirst: vi.fn() },
  graphic: { findMany: vi.fn() },
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
  adCandidateGraphicIds: null,
};

describe('generateAdCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetService = vi.spyOn(getServiceModule, 'getService');
    queryFns.onboardingSession.findFirst.mockResolvedValue(baseSession);
    queryFns.graphic.findMany.mockResolvedValue([]);
    mockGetService.mockResolvedValue({
      success: true,
      data: { id: 'svc_1', name: 'Microneedling' },
    });
    let n = 0;
    mockGenerate = vi
      .spyOn(generateGraphicFromServiceModule, 'generateGraphicFromService')
      .mockImplementation((async () => ({
        success: true,
        data: { id: `gfx_${++n}` },
      })) as never);
    setMock.mockClear();
    setMock.mockReturnValue({ where: whereMock });
  });

  afterEach(() => {
    mockGetService.mockRestore();
    mockGenerate.mockRestore();
  });

  it('creates 4 varied ad candidates and stores their ids on the session', async () => {
    await expectResult(
      generateAdCandidates(mockDb as never, { userId: 'user_1' })
    ).toSucceedWith((data) => {
      expect(data.graphicIds).toEqual(['gfx_1', 'gfx_2', 'gfx_3', 'gfx_4']);
    });

    expect(mockGenerate).toHaveBeenCalledTimes(4);
    expect(mockGenerate).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        organizationId: 'org_1',
        serviceId: 'svc_1',
        usageType: 'ad',
        offerId: 'offer_1',
      })
    );
    // Each candidate gets a DIFFERENT angle brief.
    const topicSummaries = mockGenerate.mock.calls.map(
      ([, input]) => (input as { topicSummary: string }).topicSummary
    );
    expect(new Set(topicSummaries).size).toBe(4);
    expect(setMock).toHaveBeenCalledWith({
      adCandidateGraphicIds: ['gfx_1', 'gfx_2', 'gfx_3', 'gfx_4'],
    });
  });

  it('returns the existing candidate set when all candidates are healthy', async () => {
    queryFns.onboardingSession.findFirst.mockResolvedValue({
      ...baseSession,
      adCandidateGraphicIds: ['g1', 'g2'],
    });
    queryFns.graphic.findMany.mockResolvedValue([
      { id: 'g1', status: 'ready' },
      { id: 'g2', status: 'rendering' },
    ]);

    await expectResult(
      generateAdCandidates(mockDb as never, { userId: 'user_1' })
    ).toSucceedWith((data) => {
      expect(data.graphicIds).toEqual(['g1', 'g2']);
    });
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('re-generates when an existing candidate failed', async () => {
    queryFns.onboardingSession.findFirst.mockResolvedValue({
      ...baseSession,
      adCandidateGraphicIds: ['g1', 'g2'],
    });
    queryFns.graphic.findMany.mockResolvedValue([
      { id: 'g1', status: 'ready' },
      { id: 'g2', status: 'failed' },
    ]);

    await expectResult(
      generateAdCandidates(mockDb as never, { userId: 'user_1' })
    ).toSucceedWith((data) => {
      expect(data.graphicIds).toHaveLength(4);
    });
    expect(mockGenerate).toHaveBeenCalledTimes(4);
  });

  it('returns CONFLICT when the intro offer has not been accepted yet', async () => {
    queryFns.onboardingSession.findFirst.mockResolvedValue({
      ...baseSession,
      offerId: null,
    });
    await expectResult(
      generateAdCandidates(mockDb as never, { userId: 'user_1' })
    ).toFailWithCode(ErrorCodes.CONFLICT);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('returns CONFLICT when the session has no organization or service', async () => {
    queryFns.onboardingSession.findFirst.mockResolvedValue({
      ...baseSession,
      organizationId: null,
    });
    await expectResult(
      generateAdCandidates(mockDb as never, { userId: 'user_1' })
    ).toFailWithCode(ErrorCodes.CONFLICT);
  });

  it('returns NOT_FOUND when there is no onboarding session', async () => {
    queryFns.onboardingSession.findFirst.mockResolvedValue(undefined);
    await expectResult(
      generateAdCandidates(mockDb as never, { userId: 'user_1' })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns INTERNAL_ERROR when every candidate fails to queue', async () => {
    mockGenerate.mockResolvedValue({
      success: false,
      error: { code: ErrorCodes.INTERNAL_ERROR, message: 'boom' },
    });
    await expectResult(
      generateAdCandidates(mockDb as never, { userId: 'user_1' })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
    expect(setMock).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for an out-of-range count', async () => {
    await expectResult(
      generateAdCandidates(mockDb as never, { userId: 'user_1', count: 0 })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(queryFns.onboardingSession.findFirst).not.toHaveBeenCalled();
  });
});
