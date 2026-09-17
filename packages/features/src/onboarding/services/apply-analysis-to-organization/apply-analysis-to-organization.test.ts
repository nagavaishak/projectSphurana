import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
// Spy the SOURCE modules, not the `create-organization/index.js` and
// `create-service/index.js` barrels — barrel re-exports are live getters and
// `vi.spyOn` cannot redefine them.
import * as createServiceModule from '../../../organization-services/services/create-service/create-service.service.js';
import * as createOrganizationModule from '../../../organizations/services/create-organization/create-organization.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import { applyAnalysisToOrganization } from './apply-analysis-to-organization.service.js';

// Restored `vi.spyOn`s, NOT `vi.mock`. Under `isolate: false` the worker shares
// one module graph, so a hoisted `vi.mock` of an internal module silently MISSES
// whenever some earlier file already imported the real module, and its bare
// factory poisons that module for every later file.
let mockCreateOrganization: MockInstance;
let mockCreateService: MockInstance;

/**
 * `db.select(...).from(...).where(...)` — the read chain `applyWebsiteAnalysis`
 * uses to diff the snapshot against the org. A fresh org has nothing in it, so
 * every read resolves empty; the chain is separate from the `update` chain
 * below because `where` terminates both and they resolve to different things.
 */
const selectWhere = vi.fn().mockResolvedValue([]);
const mockDb = {
  query: { onboardingSession: { findFirst: vi.fn() } },
  select: vi.fn(() => ({ from: () => ({ where: selectWhere }) })),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue(undefined),
};

const baseSession = {
  id: 'sess_1',
  userId: 'user_1',
  organizationId: null,
  status: 'active',
  websiteUrl: 'https://www.glowclinic.ie',
  analysisResult: {
    businessName: 'Glow Clinic',
    services: [
      { name: 'Microneedling', pricingDescription: '€180 per session' },
      { name: 'Chemical Peel' },
    ],
    brandVoice: ['warm', 'expert'],
    targetAudienceDescription: 'Women 30-55 near Dublin',
    primaryColor: '#AA33BB',
    secondaryColor: 'not-a-color',
    logoUrl: 'https://www.glowclinic.ie/logo.png',
    businessHours: { '1': { from: 540, to: 1080 } },
  },
};

describe('applyAnalysisToOrganization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectWhere.mockResolvedValue([]);
    mockDb.select.mockImplementation(() => ({
      from: () => ({ where: selectWhere }),
    }));
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValue(undefined);
    mockCreateOrganization = vi
      .spyOn(createOrganizationModule, 'createOrganization')
      .mockResolvedValue({
        success: true,
        data: { id: 'org_1', name: 'Glow Clinic' },
      } as never);
    mockCreateService = vi
      .spyOn(createServiceModule, 'createService')
      .mockResolvedValue({ success: true, data: { id: 'svc_n' } } as never)
      .mockResolvedValueOnce({ success: true, data: { id: 'svc_1' } } as never)
      .mockResolvedValueOnce({ success: true, data: { id: 'svc_2' } } as never);
  });

  afterEach(() => {
    mockCreateOrganization.mockRestore();
    mockCreateService.mockRestore();
  });

  it('creates the org from the snapshot, persists services and links the session', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce(baseSession);

    const result = await applyAnalysisToOrganization(mockDb as never, {
      userId: 'user_1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.organizationId).toBe('org_1');
      expect(result.data.createdServiceIds).toEqual(['svc_1', 'svc_2']);
    }

    // Org mapped from the snapshot — invalid hex secondaryColor dropped.
    expect(mockCreateOrganization).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: 'Glow Clinic',
        businessType: 'other',
        createdByUserId: 'user_1',
        websiteUrl: 'https://www.glowclinic.ie',
        logo: 'https://www.glowclinic.ie/logo.png',
        brandVoice: ['warm', 'expert'],
        targetAudienceDescription: 'Women 30-55 near Dublin',
        primaryColor: '#AA33BB',
        secondaryColor: undefined,
        businessHours: { '1': { from: 540, to: 1080 } },
      })
    );

    // Services persisted via the old wizard's path (treatment / 30min / priceText).
    expect(mockCreateService).toHaveBeenCalledTimes(2);
    expect(mockCreateService).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org_1',
        name: 'Microneedling',
        category: 'treatment',
        appointmentDuration: 30,
        priceText: '€180 per session',
      })
    );

    // Session linked to the new org.
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({ organizationId: 'org_1' });
  });

  it('is idempotent: returns the existing org without creating anything', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce({
      ...baseSession,
      organizationId: 'org_existing',
    });

    const result = await applyAnalysisToOrganization(mockDb as never, {
      userId: 'user_1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.organizationId).toBe('org_existing');
      expect(result.data.createdServiceIds).toEqual([]);
    }
    expect(mockCreateOrganization).not.toHaveBeenCalled();
    expect(mockCreateService).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when no onboarding session exists', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce(undefined);

    const result = await applyAnalysisToOrganization(mockDb as never, {
      userId: 'user_1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
    expect(mockCreateOrganization).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for a missing userId', async () => {
    const result = await applyAnalysisToOrganization(mockDb as never, {
      userId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.query.onboardingSession.findFirst).not.toHaveBeenCalled();
  });

  it('falls back to the website domain when the snapshot has no name, and skips services gracefully', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce({
      ...baseSession,
      analysisResult: null,
    });

    const result = await applyAnalysisToOrganization(mockDb as never, {
      userId: 'user_1',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.createdServiceIds).toEqual([]);
    expect(mockCreateOrganization).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'Glowclinic' })
    );
    expect(mockCreateService).not.toHaveBeenCalled();
  });

  it('returns CONFLICT when neither analysis nor website URL can name the org', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce({
      ...baseSession,
      websiteUrl: null,
      analysisResult: null,
    });

    const result = await applyAnalysisToOrganization(mockDb as never, {
      userId: 'user_1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    }
    expect(mockCreateOrganization).not.toHaveBeenCalled();
  });

  it('propagates createOrganization failures without linking the session', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce(baseSession);
    mockCreateOrganization.mockResolvedValue({
      success: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'boom',
        details: undefined,
      },
    });

    const result = await applyAnalysisToOrganization(mockDb as never, {
      userId: 'user_1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('keeps going when an individual service fails to create', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce(baseSession);
    mockCreateService.mockReset();
    mockCreateService
      .mockResolvedValueOnce({
        success: false,
        error: { code: ErrorCodes.ALREADY_EXISTS, message: 'dup' },
      })
      .mockResolvedValueOnce({ success: true, data: { id: 'svc_2' } });

    const result = await applyAnalysisToOrganization(mockDb as never, {
      userId: 'user_1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.createdServiceIds).toEqual(['svc_2']);
    }
    // Bootstrap still completed — session linked despite the failed service.
    expect(mockDb.set).toHaveBeenCalledWith({ organizationId: 'org_1' });
  });
});
