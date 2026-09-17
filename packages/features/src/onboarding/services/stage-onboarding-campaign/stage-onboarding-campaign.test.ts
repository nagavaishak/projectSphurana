import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import * as createLeadFormModule from '../../../lead-forms/services/create-lead-form/create-lead-form.service.js';
import * as getOrgDefaultsModule from '../../../org-defaults/services/get-org-defaults/get-org-defaults.service.js';
import * as getPrimaryLocationModule from '../../../organizations/services/get-primary-location/get-primary-location.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import { stageOnboardingCampaign } from './stage-onboarding-campaign.service.js';

// Restored `vi.spyOn`s, NOT `vi.mock`. Under `isolate: false` the worker shares
// one module graph, so a hoisted `vi.mock` of an internal module silently MISSES
// whenever some earlier file already imported the real module, and its bare
// factory poisons that module for every later file. Spies are installed at run
// time (load-order independent) and restored after each test.
const mocks = {
  createLeadForm: undefined as unknown as MockInstance,
  getOrgDefaults: undefined as unknown as MockInstance,
  getPrimaryLocation: undefined as unknown as MockInstance,
};

const mockDb = createMockDatabase();

const baseSession = {
  id: 'sess-1',
  userId: 'user-1',
  organizationId: 'org-1',
  offerId: 'offer-1',
  selectedServiceId: 'svc-1',
  stagedCampaign: null,
};

describe('stageOnboardingCampaign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();

    mocks.getOrgDefaults = vi
      .spyOn(getOrgDefaultsModule, 'getOrgDefaults')
      .mockResolvedValue({
        success: true,
        data: { adDailyBudgetCents: 1000, adAreaType: 'city' },
      } as never);
    mocks.getPrimaryLocation = vi
      .spyOn(getPrimaryLocationModule, 'getPrimaryLocation')
      .mockResolvedValue({
        success: true,
        data: {
          id: 'loc-1',
          label: 'Pelham Street, Dublin',
          city: 'Dublin',
          country: 'ie',
          latitude: 53.34,
          longitude: -6.26,
        },
      } as never);
    mocks.createLeadForm = vi
      .spyOn(createLeadFormModule, 'createLeadForm')
      .mockResolvedValue({
        success: true,
        data: { id: 'lf-1' },
      } as never);
  });

  afterEach(() => {
    mocks.getOrgDefaults.mockRestore();
    mocks.getPrimaryLocation.mockRestore();
    mocks.createLeadForm.mockRestore();
  });

  it('stages the campaign from org defaults, location and a new draft lead form', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce(baseSession);
    mockDb.query.offer.findFirst.mockResolvedValueOnce({
      id: 'offer-1',
      name: 'Intro Facial Offer',
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc-1',
      name: 'Facial',
    });

    const result = await stageOnboardingCampaign(mockDb as never, {
      userId: 'user-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toContain('Intro Facial Offer');
      expect(result.data.dailyBudgetCents).toBe(1000);
      // The BRANCH is staged, not its coordinates: the launcher resolves the
      // live row, so an address corrected between staging and launch is the one
      // that gets targeted.
      expect(result.data.targeting).toEqual({
        distanceKm: 20, // city catchment
        locationId: 'loc-1',
        location: 'Pelham Street, Dublin',
      });
      // IE prefers WhatsApp, but pre-connect hasUsableWhatsApp degrades to
      // false → Messenger fallback.
      expect(result.data.nurtureChannel).toBe('messenger');
      expect(result.data.leadFormId).toBe('lf-1');
      expect(result.data.launchProgress).toBe('not_started');
    }

    // Local DRAFT lead form — never synced to Meta at staging time.
    expect(mocks.createLeadForm).toHaveBeenCalledTimes(1);
    expect(mocks.createLeadForm.mock.calls[0][1]).toMatchObject({
      organizationId: 'org-1',
      syncToMeta: false,
      followUpChannel: 'messenger',
      createdById: 'user-1',
    });

    // Staged campaign persisted onto the session.
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        stagedCampaign: expect.objectContaining({
          launchProgress: 'not_started',
          leadFormId: 'lf-1',
        }),
      })
    );
  });

  it('honours an explicit dailyBudgetCents over the org default', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce(baseSession);
    mockDb.query.offer.findFirst.mockResolvedValueOnce({
      id: 'offer-1',
      name: 'Intro Facial Offer',
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc-1',
      name: 'Facial',
    });

    const result = await stageOnboardingCampaign(mockDb as never, {
      userId: 'user-1',
      dailyBudgetCents: 2500,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dailyBudgetCents).toBe(2500);
    }
  });

  it('reuses the previously created draft lead form when re-staging', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce({
      ...baseSession,
      stagedCampaign: {
        name: 'old',
        dailyBudgetCents: 1000,
        leadFormId: 'lf-existing',
        launchProgress: 'not_started',
      },
    });
    mockDb.query.offer.findFirst.mockResolvedValueOnce({
      id: 'offer-1',
      name: 'Intro Facial Offer',
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc-1',
      name: 'Facial',
    });

    const result = await stageOnboardingCampaign(mockDb as never, {
      userId: 'user-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.leadFormId).toBe('lf-existing');
    }
    expect(mocks.createLeadForm).not.toHaveBeenCalled();
  });

  it('returns CONFLICT when the session is missing prerequisites', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce({
      ...baseSession,
      offerId: null,
    });

    await expectResult(
      stageOnboardingCampaign(mockDb as never, { userId: 'user-1' })
    ).toFailWithCode(ErrorCodes.CONFLICT);

    expect(mocks.createLeadForm).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when no session exists', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      stageOnboardingCampaign(mockDb as never, { userId: 'user-1' })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for a missing userId', async () => {
    await expectResult(
      stageOnboardingCampaign(mockDb as never, { userId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.onboardingSession.findFirst).not.toHaveBeenCalled();
  });
});
