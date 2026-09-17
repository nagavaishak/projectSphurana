import { mockMetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import * as getExperimentVariantModule from '../../../experiments/services/get-experiment-variant/get-experiment-variant.service.js';
import {
  installMetaAdsSharedSpies,
  metaAdsSharedMocks,
  restoreMetaAdsSharedSpies,
} from '../../../meta-ads/services/_shared/__fixtures__/shared-spies.js';
import { ErrorCodes } from '../../../shared/index.js';
import { CampaignErrorCodes } from '../../models/index.js';

// `meta-campaigns/services/_shared` re-exports `getMetaCredentials` from
// `meta-ads/services/_shared`. It is controlled with a RESTORED spy from the
// canonical fixture, not `vi.mock` — under `pool: 'threads'` + `isolate: false`
// a bare factory persists on the shared worker module graph and DELETES every
// export it omits for the rest of the run. See the MAINTENANCE RULE in
// vite.config.ts.
const mockGetMetaCredentials = metaAdsSharedMocks.getMetaCredentials;

// Same hazard for the experiment lookup: a bare `vi.mock` factory on that
// service module persists on the shared worker graph. A RESTORED spy keeps the
// real module intact outside this file.
// The spy delegates to this stable handle so tests can program it without
// re-reaching for the (per-test, restorable) spy object.
const mockGetExperimentVariant = vi.fn();
let getExperimentVariantSpy: { mockRestore: () => void } | undefined;

import { createCampaignSchema } from './create-campaign.schema.js';
import { createCampaign } from './create-campaign.service.js';
const mockCreateCampaign = vi.mocked(mockMetaAdsService.createCampaign);
const mockCreateAdSet = vi.mocked(mockMetaAdsService.createAdSet);

/**
 * The org's branch, which is now the ONLY source of a campaign's geo. Every
 * create resolves one — a country-targeted campaign still names a branch (for
 * attribution and its landing page), it just doesn't need coordinates.
 */
const branchRow = {
  id: 'loc-1',
  organizationId: 'org_123',
  addressLine1: 'Pelham Street',
  city: 'Dublin',
  country: 'ie',
  latitude: 53.34,
  longitude: -6.26,
  isPrimary: true,
  sortOrder: 0,
};

// `row: null` means "no such branch". Note it is NOT defaulted via
// `row = branchRow`: a default parameter also fires for an explicit
// `undefined`, so the no-branch case would silently get the happy-path row.
const branchQuery = (row: unknown) => ({
  organizationLocation: { findFirst: vi.fn().mockResolvedValue(row) },
});

const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  query: branchQuery(branchRow),
} as never;

/**
 * A db that can also answer the microsite host lookup, for the destination
 * tests. The plain `mockDb` above deliberately cannot — which is itself the
 * assertion that a host-resolution failure never fails a campaign create.
 */
const dbWithMicrosite = (primaryDomain: string | null) =>
  ({
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    query: {
      ...branchQuery(branchRow),
      organization: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'org_123', slug: 'glow-salon' }),
      },
      micrositeDomain: {
        findFirst: vi
          .fn()
          .mockResolvedValue(primaryDomain ? { domain: primaryDomain } : null),
      },
    },
  }) as never;

const okCredentials = {
  success: true as const,
  data: {
    credentials: {
      accessToken: 'tok',
      adAccountId: 'act_123',
      pageId: 'page_1',
    },
    integration: { id: 'int-1', adAccountId: 'act_123' },
    resolvedPage: { id: 'rp-1', pageId: 'page_1', pageName: 'Test Page' },
  },
};

describe('createCampaign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMetaAdsSharedSpies('getMetaCredentials');
    getExperimentVariantSpy = vi
      .spyOn(getExperimentVariantModule, 'getExperimentVariant')
      .mockImplementation((...args) =>
        mockGetExperimentVariant(...(args as unknown[]))
      );
    // Default: no experiment active
    mockGetExperimentVariant.mockResolvedValue({ success: true, data: null });
  });

  afterEach(() => {
    restoreMetaAdsSharedSpies();
    getExperimentVariantSpy?.mockRestore();
    getExperimentVariantSpy = undefined;
  });

  const validInput = {
    organizationId: 'org_123',
    name: 'Summer Sale Campaign',
    objective: 'OUTCOME_LEADS' as const,
    dailyBudget: 5000,
    targeting: { countries: ['US'] },
  };

  it('should create a campaign with valid input', async () => {
    mockGetMetaCredentials.mockResolvedValueOnce({
      success: true,
      data: {
        credentials: {
          accessToken: 'tok',
          adAccountId: 'act_123',
          pageId: 'page_1',
        },
        integration: { id: 'int-1', adAccountId: 'act_123' },
        resolvedPage: { id: 'rp-1', pageId: 'page_1', pageName: 'Test Page' },
      },
    });

    mockCreateCampaign.mockResolvedValueOnce('meta_camp_123');
    mockCreateAdSet.mockResolvedValueOnce('meta_adset_123');

    const result = await createCampaign(mockDb, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metaCampaignId).toBe('meta_camp_123');
      expect(result.data.metaAdSetId).toBe('meta_adset_123');
    }
    expect(mockCreateCampaign).toHaveBeenCalled();
    expect(mockCreateAdSet).toHaveBeenCalled();
  });

  it('should create a campaign with all optional fields', async () => {
    const fullInput = {
      ...validInput,
      lifetimeBudget: 100000,
      startDate: new Date('2024-06-01'),
      endDate: new Date('2024-06-30'),
    };

    mockGetMetaCredentials.mockResolvedValueOnce({
      success: true,
      data: {
        credentials: {
          accessToken: 'tok',
          adAccountId: 'act_123',
          pageId: 'page_1',
        },
        integration: { id: 'int-1', adAccountId: 'act_123' },
        resolvedPage: { id: 'rp-1', pageId: 'page_1', pageName: 'Test Page' },
      },
    });

    mockCreateCampaign.mockResolvedValueOnce('meta_camp_456');
    mockCreateAdSet.mockResolvedValueOnce('meta_adset_456');

    const result = await createCampaign(mockDb, fullInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metaCampaignId).toBe('meta_camp_456');
      expect(result.data.metaAdSetId).toBe('meta_adset_456');
    }
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      name: 'Test Campaign',
      objective: 'OUTCOME_LEADS' as const,
    };

    await expectResult(
      createCampaign(mockDb, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockCreateCampaign).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing name', async () => {
    const invalidInput = {
      organizationId: 'org_123',
      objective: 'OUTCOME_LEADS' as const,
    };

    await expectResult(
      createCampaign(mockDb, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockCreateCampaign).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing objective', async () => {
    const invalidInput = {
      organizationId: 'org_123',
      name: 'Test Campaign',
    };

    await expectResult(
      createCampaign(mockDb, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockCreateCampaign).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for invalid objective value', async () => {
    const invalidInput = {
      ...validInput,
      objective: 'INVALID_OBJECTIVE',
    };

    await expectResult(
      createCampaign(mockDb, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockCreateCampaign).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for negative dailyBudget', async () => {
    const invalidInput = {
      ...validInput,
      dailyBudget: -100,
    };

    await expectResult(
      createCampaign(mockDb, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockCreateCampaign).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR when no budget provided', async () => {
    const noBudgetInput = {
      organizationId: 'org_123',
      name: 'No Budget Campaign',
      objective: 'OUTCOME_LEADS' as const,
      targeting: { countries: ['US'] },
    };

    mockGetMetaCredentials.mockResolvedValueOnce({
      success: true,
      data: {
        credentials: {
          accessToken: 'tok',
          adAccountId: 'act_123',
          pageId: 'page_1',
        },
        integration: { id: 'int-1', adAccountId: 'act_123' },
        resolvedPage: { id: 'rp-1', pageId: 'page_1', pageName: 'Test Page' },
      },
    });

    const result = await createCampaign(mockDb, noBudgetInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(result.error.message).toContain('budget');
    }
  });

  it('should propagate error when getMetaCredentials fails', async () => {
    mockGetMetaCredentials.mockResolvedValueOnce({
      success: false,
      error: {
        code: CampaignErrorCodes.META_NOT_CONFIGURED,
        message: 'Not configured',
      },
    });

    const result = await createCampaign(mockDb, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(CampaignErrorCodes.META_NOT_CONFIGURED);
    }
  });

  it('should return META_SYNC_FAILED when Meta API throws', async () => {
    mockGetMetaCredentials.mockResolvedValueOnce({
      success: true,
      data: {
        credentials: {
          accessToken: 'tok',
          adAccountId: 'act_123',
          pageId: 'page_1',
        },
        integration: { id: 'int-1', adAccountId: 'act_123' },
        resolvedPage: { id: 'rp-1', pageId: 'page_1', pageName: 'Test Page' },
      },
    });

    mockCreateCampaign.mockRejectedValueOnce(new Error('Meta API error'));

    const result = await createCampaign(mockDb, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(CampaignErrorCodes.META_SYNC_FAILED);
    }
  });

  it('should create a campaign with chatbot follow-up config', async () => {
    const chatbotInput = {
      ...validInput,
      followUpType: 'chatbot' as const,
      chatbotId: 'chatbot-001',
      conversionDestination: 'messenger' as const,
    };

    mockGetMetaCredentials.mockResolvedValueOnce({
      success: true,
      data: {
        credentials: {
          accessToken: 'tok',
          adAccountId: 'act_123',
          pageId: 'page_1',
        },
        integration: { id: 'int-1', adAccountId: 'act_123' },
        resolvedPage: { id: 'rp-1', pageId: 'page_1', pageName: 'Test Page' },
      },
    });

    mockCreateCampaign.mockResolvedValueOnce('meta_camp_789');
    mockCreateAdSet.mockResolvedValueOnce('meta_adset_789');

    const result = await createCampaign(mockDb, chatbotInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.followUpType).toBe('chatbot');
      expect(result.data.conversionDestination).toBe('messenger');
    }
  });

  it('should return META_SYNC_FAILED with permission error message', async () => {
    mockGetMetaCredentials.mockResolvedValueOnce({
      success: true,
      data: {
        credentials: {
          accessToken: 'tok',
          adAccountId: 'act_123',
          pageId: 'page_1',
        },
        integration: { id: 'int-1', adAccountId: 'act_123' },
        resolvedPage: { id: 'rp-1', pageId: 'page_1', pageName: 'Test Page' },
      },
    });

    mockCreateCampaign.mockRejectedValueOnce(
      new Error('User does not have permission to perform this action')
    );

    const result = await createCampaign(mockDb, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(CampaignErrorCodes.META_SYNC_FAILED);
      expect(result.error.message).toContain('permission');
    }
  });

  it('should return META_SYNC_FAILED with token expired message', async () => {
    mockGetMetaCredentials.mockResolvedValueOnce({
      success: true,
      data: {
        credentials: {
          accessToken: 'tok',
          adAccountId: 'act_123',
          pageId: 'page_1',
        },
        integration: { id: 'int-1', adAccountId: 'act_123' },
        resolvedPage: { id: 'rp-1', pageId: 'page_1', pageName: 'Test Page' },
      },
    });

    mockCreateCampaign.mockRejectedValueOnce(
      new Error('Invalid OAuth access token')
    );

    const result = await createCampaign(mockDb, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('META_AUTH_EXPIRED');
      expect(result.error.message).toContain('no longer valid');
    }
  });

  it('should return META_SYNC_FAILED with budget error message', async () => {
    mockGetMetaCredentials.mockResolvedValueOnce({
      success: true,
      data: {
        credentials: {
          accessToken: 'tok',
          adAccountId: 'act_123',
          pageId: 'page_1',
        },
        integration: {
          id: 'int-1',
          adAccountId: 'act_123',
          availableAdAccounts: [{ id: 'act_123', currency: 'USD' }],
        },
        resolvedPage: { id: 'rp-1', pageId: 'page_1', pageName: 'Test Page' },
      },
    });

    mockCreateCampaign.mockRejectedValueOnce(
      new Error('Minimum budget not met for this campaign')
    );

    const result = await createCampaign(mockDb, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(CampaignErrorCodes.META_SYNC_FAILED);
      expect(result.error.message).toContain('budget');
    }
  });

  describe('chatbot campaign optimization mode', () => {
    const chatbotInput = {
      ...validInput,
      followUpType: 'chatbot' as const,
      conversionDestination: 'messenger' as const,
    };

    const mockCredentials = {
      success: true,
      data: {
        credentials: {
          accessToken: 'tok',
          adAccountId: 'act_123',
          pageId: 'page_1',
        },
        integration: { id: 'int-1', adAccountId: 'act_123' },
        resolvedPage: { id: 'rp-1', pageId: 'page_1', pageName: 'Test Page' },
      },
    };

    it('should use LEAD_GENERATION optimization for OUTCOME_LEADS chatbot campaigns', async () => {
      mockGetExperimentVariant.mockResolvedValueOnce({
        success: true,
        data: null,
      });
      mockGetMetaCredentials.mockResolvedValueOnce(mockCredentials);
      mockCreateCampaign.mockResolvedValueOnce('meta_camp_leads');
      mockCreateAdSet.mockResolvedValueOnce('meta_adset_leads');

      const result = await createCampaign(mockDb, chatbotInput);

      expect(result.success).toBe(true);
      expect(mockCreateCampaign).toHaveBeenCalledWith(
        expect.objectContaining({ objective: 'OUTCOME_LEADS' })
      );
      expect(mockCreateAdSet).toHaveBeenCalledWith(
        expect.objectContaining({ optimizationGoal: 'LEAD_GENERATION' })
      );
    });

    it('should use CONVERSATIONS optimization for OUTCOME_ENGAGEMENT chatbot campaigns', async () => {
      mockGetExperimentVariant.mockResolvedValueOnce({
        success: true,
        data: null,
      });
      mockGetMetaCredentials.mockResolvedValueOnce(mockCredentials);
      mockCreateCampaign.mockResolvedValueOnce('meta_camp_engage');
      mockCreateAdSet.mockResolvedValueOnce('meta_adset_engage');

      const result = await createCampaign(mockDb, {
        ...chatbotInput,
        objective: 'OUTCOME_ENGAGEMENT',
      });

      expect(result.success).toBe(true);
      expect(mockCreateCampaign).toHaveBeenCalledWith(
        expect.objectContaining({ objective: 'OUTCOME_ENGAGEMENT' })
      );
      expect(mockCreateAdSet).toHaveBeenCalledWith(
        expect.objectContaining({ optimizationGoal: 'CONVERSATIONS' })
      );
    });

    it('should not check experiment for non-chatbot campaigns', async () => {
      mockGetMetaCredentials.mockResolvedValueOnce(mockCredentials);
      mockCreateCampaign.mockResolvedValueOnce('meta_camp_nc');
      mockCreateAdSet.mockResolvedValueOnce('meta_adset_nc');

      await createCampaign(mockDb, validInput);

      expect(mockGetExperimentVariant).not.toHaveBeenCalled();
    });
  });

  describe('chatbot campaign destinations', () => {
    const baseChatbotInput = {
      organizationId: 'org_123',
      name: 'Destination Campaign',
      dailyBudget: 5000,
      targeting: { countries: ['US'] },
      followUpType: 'chatbot' as const,
      conversionDestination: 'messenger' as const,
      objective: 'OUTCOME_ENGAGEMENT' as const,
    };

    const mockCredentials = {
      success: true,
      data: {
        credentials: {
          accessToken: 'tok',
          adAccountId: 'act_123',
          pageId: 'page_1',
        },
        integration: { id: 'int-1', adAccountId: 'act_123' },
        resolvedPage: { id: 'rp-1', pageId: 'page_1', pageName: 'Test Page' },
      },
    };

    it('passes MESSENGER destinationType + CONVERSATIONS goal for messenger-only engagement', async () => {
      mockGetMetaCredentials.mockResolvedValueOnce(mockCredentials);
      mockCreateCampaign.mockResolvedValueOnce('meta_camp_m');
      mockCreateAdSet.mockResolvedValueOnce('meta_adset_m');

      await createCampaign(mockDb, {
        ...baseChatbotInput,
        destinations: ['messenger'],
      });

      expect(mockCreateAdSet).toHaveBeenCalledWith(
        expect.objectContaining({
          destinationType: 'MESSENGER',
          optimizationGoal: 'CONVERSATIONS',
        })
      );
    });

    it('passes INSTAGRAM_DIRECT destinationType + CONVERSATIONS goal for instagram_dm-only engagement', async () => {
      mockGetMetaCredentials.mockResolvedValueOnce(mockCredentials);
      mockCreateCampaign.mockResolvedValueOnce('meta_camp_ig');
      mockCreateAdSet.mockResolvedValueOnce('meta_adset_ig');

      await createCampaign(mockDb, {
        ...baseChatbotInput,
        destinations: ['instagram_dm'],
      });

      expect(mockCreateAdSet).toHaveBeenCalledWith(
        expect.objectContaining({
          destinationType: 'INSTAGRAM_DIRECT',
          optimizationGoal: 'CONVERSATIONS',
        })
      );
    });

    it('passes WHATSAPP destinationType + LINK_CLICKS goal for whatsapp-only engagement', async () => {
      // WhatsApp forces LINK_CLICKS — CONVERSATIONS is blocked by Meta on
      // EU ad accounts, so we use LINK_CLICKS for all WhatsApp campaigns
      // to avoid runtime rejections.
      mockGetMetaCredentials.mockResolvedValueOnce(mockCredentials);
      mockCreateCampaign.mockResolvedValueOnce('meta_camp_wa');
      mockCreateAdSet.mockResolvedValueOnce('meta_adset_wa');

      await createCampaign(mockDb, {
        ...baseChatbotInput,
        destinations: ['whatsapp'],
      });

      expect(mockCreateAdSet).toHaveBeenCalledWith(
        expect.objectContaining({
          destinationType: 'WHATSAPP',
          optimizationGoal: 'LINK_CLICKS',
        })
      );
    });

    it('drops WhatsApp on OUTCOME_ENGAGEMENT triple combo (EU restriction)', async () => {
      mockGetMetaCredentials.mockResolvedValueOnce(mockCredentials);
      mockCreateCampaign.mockResolvedValueOnce('meta_camp_tri_eng');
      mockCreateAdSet.mockResolvedValueOnce('meta_adset_tri_eng');

      await createCampaign(mockDb, {
        ...baseChatbotInput,
        destinations: ['whatsapp', 'messenger', 'instagram_dm'],
      });

      // WhatsApp is present → LINK_CLICKS; destinationType collapses to the
      // non-WhatsApp combo because OUTCOME_ENGAGEMENT can't carry WhatsApp.
      expect(mockCreateAdSet).toHaveBeenCalledWith(
        expect.objectContaining({
          destinationType: 'MESSAGING_INSTAGRAM_DIRECT_MESSENGER',
          optimizationGoal: 'LINK_CLICKS',
        })
      );
    });

    it('collapses to WHATSAPP + LEAD_GENERATION on OUTCOME_LEADS with WhatsApp selected', async () => {
      mockGetMetaCredentials.mockResolvedValueOnce(mockCredentials);
      mockCreateCampaign.mockResolvedValueOnce('meta_camp_leads_wa');
      mockCreateAdSet.mockResolvedValueOnce('meta_adset_leads_wa');

      await createCampaign(mockDb, {
        ...baseChatbotInput,
        objective: 'OUTCOME_LEADS',
        destinations: ['whatsapp', 'messenger', 'instagram_dm'],
      });

      expect(mockCreateAdSet).toHaveBeenCalledWith(
        expect.objectContaining({
          destinationType: 'WHATSAPP',
          optimizationGoal: 'LEAD_GENERATION',
        })
      );
    });
  });
});

describe('createCampaignSchema — start/end date coercion', () => {
  it('coerces ISO date strings to Date objects', () => {
    const parsed = createCampaignSchema.parse({
      organizationId: 'org-1',
      name: 'Campaign',
      objective: 'OUTCOME_LEADS',
      targeting: { countries: ['IE'] },
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-02-01T00:00:00.000Z',
    });

    expect(parsed.startDate).toBeInstanceOf(Date);
    expect(parsed.startDate?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(parsed.endDate?.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('treats falsy dates as absent rather than invalid', () => {
    // Preserves the controller's old `dto.startDate ? new Date(...) : undefined`
    // step now that the controller forwards the DTO untouched.
    const parsed = createCampaignSchema.parse({
      organizationId: 'org-1',
      name: 'Campaign',
      objective: 'OUTCOME_LEADS',
      targeting: { countries: ['IE'] },
      startDate: '',
      endDate: null,
    });

    expect(parsed.startDate).toBeUndefined();
    expect(parsed.endDate).toBeUndefined();
  });

  it('rejects an unparseable date', () => {
    const parsed = createCampaignSchema.safeParse({
      organizationId: 'org-1',
      name: 'Campaign',
      objective: 'OUTCOME_LEADS',
      targeting: { countries: ['IE'] },
      startDate: 'not-a-date',
    });

    expect(parsed.success).toBe(false);
  });
});

describe('createCampaign — microsite destination (plan §9.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMetaAdsSharedSpies('getMetaCredentials');
    getExperimentVariantSpy = vi
      .spyOn(getExperimentVariantModule, 'getExperimentVariant')
      .mockImplementation((...args) =>
        mockGetExperimentVariant(...(args as unknown[]))
      );
    mockGetExperimentVariant.mockResolvedValue({ success: true, data: null });
  });

  afterEach(() => {
    restoreMetaAdsSharedSpies();
    getExperimentVariantSpy?.mockRestore();
    getExperimentVariantSpy = undefined;
  });

  const validInput = {
    organizationId: 'org_123',
    name: 'Summer Sale Campaign',
    objective: 'OUTCOME_LEADS' as const,
    dailyBudget: 5000,
    targeting: { countries: ['US'] },
  };

  const siteInput = {
    ...validInput,
    // lead_form / chatbot campaigns have no URL destination.
    followUpType: 'email_only' as const,
  };

  const arrange = () => {
    mockGetMetaCredentials.mockResolvedValueOnce(okCredentials);
    mockCreateCampaign.mockResolvedValueOnce('meta_camp_123');
    mockCreateAdSet.mockResolvedValueOnce('meta_adset_123');
  };

  it('sends traffic to the TENANT host when a custom domain is live', async () => {
    arrange();
    const result = await createCampaign(
      dbWithMicrosite('salon.com'),
      siteInput
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    const url = new URL(result.data.destinationUrl ?? '');
    expect(url.host).toBe('salon.com');
    expect(url.pathname).toBe('/book');
    // The join key for CAC: the Meta campaign id, not the campaign name.
    expect(url.searchParams.get('utm_campaign')).toBe('meta_camp_123');
    expect(url.searchParams.get('utm_source')).toBe('meta');
  });

  it('falls back to the path tier when no domain is live', async () => {
    arrange();
    const result = await createCampaign(dbWithMicrosite(null), siteInput);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.destinationUrl).toContain('/sites/glow-salon/book');
    expect(result.data.destinationUrl).toContain('utm_campaign=meta_camp_123');
  });

  it('does not set a destination for lead-form campaigns', async () => {
    arrange();
    const result = await createCampaign(dbWithMicrosite('salon.com'), {
      ...validInput,
      followUpType: 'lead_form' as const,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.destinationUrl).toBeUndefined();
  });

  it('still creates the campaign when the host cannot be resolved', async () => {
    // The campaign already exists on Meta by this point. A missing landing
    // page is a missing convenience, never a reason to fail the create.
    arrange();
    const result = await createCampaign(mockDb, siteInput);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.metaCampaignId).toBe('meta_camp_123');
    expect(result.data.destinationUrl).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Geo comes from the BRANCH (§13)
  // ─────────────────────────────────────────────────────────────────────────
  describe('branch-derived geo', () => {
    const arrange = () => {
      mockGetMetaCredentials.mockResolvedValueOnce(okCredentials);
      mockCreateCampaign.mockResolvedValueOnce('meta_camp_123');
      mockCreateAdSet.mockResolvedValueOnce('meta_adset_123');
    };

    /** The radius case: no `countries`, so the branch must be placeable. */
    const radiusInput = {
      organizationId: 'org_123',
      name: 'Botox — September',
      objective: 'OUTCOME_LEADS' as const,
      dailyBudget: 5000,
      targeting: { distanceKm: 30 },
    };

    it("centres the radius on the org's default branch", async () => {
      arrange();
      const result = await createCampaign(mockDb, radiusInput);

      expect(result.success).toBe(true);
      const adSetArgs = mockCreateAdSet.mock.calls[0][0];
      expect(adSetArgs.targeting).toMatchObject({
        geo_locations: {
          custom_locations: [
            {
              latitude: branchRow.latitude,
              longitude: branchRow.longitude,
              radius: 30,
              distance_unit: 'kilometer',
            },
          ],
        },
      });
      if (result.success) {
        expect(result.data.location).toEqual({
          id: 'loc-1',
          label: 'Pelham Street, Dublin',
        });
      }
    });

    it('records the branch on the campaign config', async () => {
      arrange();
      const db = {
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        query: branchQuery(branchRow),
      } as never;

      await createCampaign(db, radiusInput);

      const inserted = (
        db as unknown as { values: { mock: { calls: unknown[][] } } }
      ).values.mock.calls[0][0] as { locationId?: string };
      expect(inserted.locationId).toBe('loc-1');
    });

    it('targets the named branch when one is given', async () => {
      arrange();
      const cork = {
        ...branchRow,
        id: 'loc-cork',
        city: 'Cork',
        latitude: 51.9,
        longitude: -8.47,
      };
      const db = {
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        query: branchQuery(cork),
      } as never;

      const result = await createCampaign(db, {
        ...radiusInput,
        locationId: 'loc-cork',
      });

      expect(result.success).toBe(true);
      const adSetArgs = mockCreateAdSet.mock.calls[0][0];
      expect(
        (
          adSetArgs.targeting as {
            geo_locations: { custom_locations: { latitude: number }[] };
          }
        ).geo_locations.custom_locations[0].latitude
      ).toBe(51.9);
    });

    it("refuses a foreign branch rather than falling back to someone else's address", async () => {
      const db = {
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        query: branchQuery(null),
      } as never;

      const result = await createCampaign(db, {
        ...radiusInput,
        locationId: 'loc-someone-else',
      });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(mockCreateCampaign).not.toHaveBeenCalled();
    });

    it('refuses a radius campaign when the branch has no coordinates', async () => {
      // The alternative this replaced was guessing a country, which is how US
      // and UK clinics' spend was pointed at Ireland.
      const db = {
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        query: branchQuery({ ...branchRow, latitude: null, longitude: null }),
      } as never;

      const result = await createCampaign(db, radiusInput);

      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      // Nothing was created on Meta — this fails BEFORE any spend exists.
      expect(mockCreateCampaign).not.toHaveBeenCalled();
    });

    it('allows a NATIONAL campaign from a branch with no coordinates', async () => {
      // A country-targeted campaign needs the branch for attribution and its
      // landing page, not for a radius — so an ungeocoded address must not
      // block it.
      arrange();
      const db = {
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        query: branchQuery({ ...branchRow, latitude: null, longitude: null }),
      } as never;

      const result = await createCampaign(db, {
        ...radiusInput,
        targeting: { countries: ['IE'] },
      });

      expect(result.success).toBe(true);
      const geo = (
        mockCreateAdSet.mock.calls[0][0].targeting as {
          geo_locations: Record<string, unknown>;
        }
      ).geo_locations;
      expect(geo.countries).toEqual(['IE']);
      expect(geo.custom_locations).toBeUndefined();
    });

    it('rejects caller-supplied coordinates at the schema boundary', () => {
      const parsed = createCampaignSchema.safeParse({
        ...radiusInput,
        targeting: { latitude: 0, longitude: 0, distanceKm: 25 },
      });

      // Unknown keys are stripped, not errors — the point is that they can no
      // longer reach Meta, which is what Null Island was.
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.targeting).not.toHaveProperty('latitude');
        expect(parsed.data.targeting).not.toHaveProperty('longitude');
      }
    });
  });
});
