import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaAdsService } from '../../meta-ads/meta-ads.service.js';
import type {
  MetaAdCreativeConfig,
  MetaAdSetConfig,
  MetaCampaignConfig,
} from '../../meta-ads/meta-ads.types.js';
import {
  captureRequest,
  expectMatchesContract,
  okResponse,
} from '../testing.js';

/**
 * REQUEST-CONTRACT TESTS — Marketing API writes.
 *
 * These answer the question the E2E suite is the wrong tool for: *does our code
 * build the payload Meta expects?* They run in milliseconds with no network, so
 * "we added a parameter" fails as a named assertion in CI instead of as a
 * ten-minute timeout against a rate-limited ad account.
 *
 * Every payload is validated against the SAME strict schema the contract fake
 * enforces (`expectMatchesContract`), so Tier 1 and Tier 2 share one source of
 * truth and cannot drift apart.
 *
 * The variant matrix below is the specific fear this was built for: video vs
 * image creatives, CDN-signed vs S3-presigned media, and each ad destination.
 */

const CREDENTIALS = {
  accessToken: 'test-token',
  adAccountId: '123456',
  pageId: 'page-1',
};

const CDN_URL = 'https://cdn.borradh.io/videos/clip.mp4?Signature=abc';
const S3_URL =
  'https://borradh-assets.s3.eu-west-1.amazonaws.com/videos/clip.mp4?X-Amz-Signature=abc';

let service: MetaAdsService;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(okResponse());
  vi.stubGlobal('fetch', fetchMock);
  // The service logs payloads on create; keep the test output readable.
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  service = new MetaAdsService(CREDENTIALS);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const baseCampaign: MetaCampaignConfig = {
  name: 'E2E Campaign',
  objective: 'OUTCOME_LEADS',
  status: 'PAUSED',
};

const baseAdSet: MetaAdSetConfig = {
  name: 'E2E Ad Set',
  campaignId: 'camp-1',
  status: 'PAUSED',
  billingEvent: 'IMPRESSIONS',
  optimizationGoal: 'LEAD_GENERATION',
  targeting: { geo_locations: { countries: ['IE'] } },
};

function creativeWithVideo(
  overrides: Partial<MetaAdCreativeConfig['objectStorySpec']['videoData']> = {}
): MetaAdCreativeConfig {
  return {
    name: 'E2E Creative',
    objectStorySpec: {
      pageId: 'page-1',
      videoData: {
        videoId: 'video-1',
        message: 'Book now',
        ...overrides,
      },
    },
  } as MetaAdCreativeConfig;
}

describe('createCampaign', () => {
  it('satisfies the contract without a budget (ABO)', async () => {
    await service.createCampaign(baseCampaign);

    const payload = expectMatchesContract(
      captureRequest(fetchMock),
      'ads.createCampaign'
    );

    // Without campaign-budget optimisation, Meta requires the ad-set budget
    // sharing flag and must NOT carry a campaign bid strategy.
    expect(payload.is_adset_budget_sharing_enabled).toBe(false);
    expect(payload.bid_strategy).toBeUndefined();
    expect(payload.buying_type).toBe('AUCTION');
    expect(payload.special_ad_categories).toEqual([]);
  });

  it('switches to CBO shape when a daily budget is set', async () => {
    await service.createCampaign({ ...baseCampaign, dailyBudget: 1000 });

    const payload = expectMatchesContract(
      captureRequest(fetchMock),
      'ads.createCampaign'
    );

    // With CBO the bid strategy moves to the campaign so ad sets inherit it,
    // and the budget-sharing flag must disappear.
    expect(payload.bid_strategy).toBe('LOWEST_COST_WITHOUT_CAP');
    expect(payload.daily_budget).toBe(1000);
    expect(payload.is_adset_budget_sharing_enabled).toBeUndefined();
  });

  it('carries a lifetime budget as CBO too', async () => {
    await service.createCampaign({ ...baseCampaign, lifetimeBudget: 50_000 });

    const payload = expectMatchesContract(
      captureRequest(fetchMock),
      'ads.createCampaign'
    );
    expect(payload.lifetime_budget).toBe(50_000);
    expect(payload.is_adset_budget_sharing_enabled).toBeUndefined();
  });

  it('forwards special ad categories', async () => {
    await service.createCampaign({
      ...baseCampaign,
      specialAdCategories: ['EMPLOYMENT'],
    });

    const payload = expectMatchesContract(
      captureRequest(fetchMock),
      'ads.createCampaign'
    );
    expect(payload.special_ad_categories).toEqual(['EMPLOYMENT']);
  });
});

describe('createAdSet', () => {
  it('satisfies the contract with the minimum required fields', async () => {
    await service.createAdSet(baseAdSet);

    const payload = expectMatchesContract(
      captureRequest(fetchMock),
      'ads.createAdSet'
    );
    expect(payload.campaign_id).toBe('camp-1');
    expect(payload.targeting).toEqual({ geo_locations: { countries: ['IE'] } });
    // Under CBO the strategy is inherited from the campaign, never repeated.
    expect(payload.bid_strategy).toBeUndefined();
  });

  it.each([
    [
      'Messenger / chatbot destination',
      {
        destinationType: 'MESSENGER',
        promotedObject: { pageId: 'page-1' },
      },
      (p: Record<string, unknown>) => {
        expect(p.destination_type).toBe('MESSENGER');
        expect(p.promoted_object).toEqual({ page_id: 'page-1' });
      },
    ],
    [
      'WhatsApp destination',
      {
        destinationType: 'WHATSAPP',
        promotedObject: { pageId: 'page-1', whatsappPhoneNumber: '353850000' },
      },
      (p: Record<string, unknown>) => {
        expect(p.destination_type).toBe('WHATSAPP');
        expect(p.promoted_object).toMatchObject({
          whatsapp_phone_number: '353850000',
        });
      },
    ],
    [
      'website / pixel destination',
      {
        destinationType: 'WEBSITE',
        promotedObject: { pixelId: 'pixel-1', customEventType: 'LEAD' },
      },
      (p: Record<string, unknown>) => {
        expect(p.promoted_object).toMatchObject({
          pixel_id: 'pixel-1',
          custom_event_type: 'LEAD',
        });
      },
    ],
    [
      'lead-form destination (ON_AD)',
      { destinationType: 'ON_AD', promotedObject: { pageId: 'page-1' } },
      (p: Record<string, unknown>) => {
        expect(p.destination_type).toBe('ON_AD');
      },
    ],
  ])(
    'satisfies the contract for the %s',
    async (_label, overrides, assertions) => {
      await service.createAdSet({
        ...baseAdSet,
        ...(overrides as Partial<MetaAdSetConfig>),
      });

      const payload = expectMatchesContract(
        captureRequest(fetchMock),
        'ads.createAdSet'
      );
      (assertions as (p: Record<string, unknown>) => void)(payload);
    }
  );

  it('carries DSA fields when supplied (EU compliance)', async () => {
    await service.createAdSet({
      ...baseAdSet,
      dsaBeneficiary: 'Borradh Ltd',
      dsaPayor: 'Borradh Ltd',
    });

    const payload = expectMatchesContract(
      captureRequest(fetchMock),
      'ads.createAdSet'
    );
    expect(payload.dsa_beneficiary).toBe('Borradh Ltd');
    expect(payload.dsa_payor).toBe('Borradh Ltd');
  });

  it('sets an explicit bid strategy in ABO mode', async () => {
    await service.createAdSet({
      ...baseAdSet,
      bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
      dailyBudget: 500,
    });

    const payload = expectMatchesContract(
      captureRequest(fetchMock),
      'ads.createAdSet'
    );
    expect(payload.bid_strategy).toBe('LOWEST_COST_WITHOUT_CAP');
    expect(payload.daily_budget).toBe(500);
  });
});

describe('createAdCreative — the media variant matrix', () => {
  it('builds a video creative', async () => {
    await service.createAdCreative(creativeWithVideo());

    const payload = expectMatchesContract(
      captureRequest(fetchMock),
      'ads.createAdCreative'
    );
    const spec = payload.object_story_spec as Record<string, unknown>;

    expect(spec.video_data).toMatchObject({ video_id: 'video-1' });
    // A video creative must never also carry link_data — Meta rejects both.
    expect(spec.link_data).toBeUndefined();
  });

  it.each([
    ['a CDN-signed thumbnail', CDN_URL],
    ['an S3-presigned thumbnail', S3_URL],
  ])('accepts %s unchanged', async (_label, url) => {
    // The media URL is resolved upstream (CDN re-sign vs S3 presign). Whatever
    // it resolved to must reach Meta byte-for-byte — re-encoding or truncating
    // a signed URL is how you get FB code 324 / IG 9004 at publish time.
    await service.createAdCreative(creativeWithVideo({ imageUrl: url }));

    const payload = expectMatchesContract(
      captureRequest(fetchMock),
      'ads.createAdCreative'
    );
    const spec = payload.object_story_spec as Record<string, unknown>;
    const videoData = spec.video_data as Record<string, unknown>;

    expect(videoData.image_url).toBe(url);
  });

  it('attaches a lead-gen form call to action', async () => {
    await service.createAdCreative(
      creativeWithVideo({
        callToAction: {
          type: 'SIGN_UP',
          value: { leadGenFormId: 'form-1' },
        },
      })
    );

    const payload = expectMatchesContract(
      captureRequest(fetchMock),
      'ads.createAdCreative'
    );
    const spec = payload.object_story_spec as Record<string, unknown>;
    const videoData = spec.video_data as Record<string, unknown>;

    expect(videoData.call_to_action).toEqual({
      type: 'SIGN_UP',
      value: { lead_gen_form_id: 'form-1' },
    });
  });

  it('attaches a link call to action', async () => {
    await service.createAdCreative(
      creativeWithVideo({
        callToAction: {
          type: 'BOOK_TRAVEL',
          value: { link: 'https://borradh.io/book' },
        },
      })
    );

    const payload = expectMatchesContract(
      captureRequest(fetchMock),
      'ads.createAdCreative'
    );
    const spec = payload.object_story_spec as Record<string, unknown>;
    const videoData = spec.video_data as Record<string, unknown>;

    expect(videoData.call_to_action).toEqual({
      type: 'BOOK_TRAVEL',
      value: { link: 'https://borradh.io/book' },
    });
  });

  it('carries the Instagram actor when the page has a linked IG account', async () => {
    const config = creativeWithVideo();
    config.objectStorySpec.instagramActorId = 'ig-1';

    await service.createAdCreative(config);

    const payload = expectMatchesContract(
      captureRequest(fetchMock),
      'ads.createAdCreative'
    );
    const spec = payload.object_story_spec as Record<string, unknown>;

    expect(spec.instagram_user_id).toBe('ig-1');
  });
});

describe('createAd', () => {
  it('satisfies the contract', async () => {
    await service.createAd({
      name: 'E2E Ad',
      adSetId: 'adset-1',
      creativeId: 'creative-1',
      status: 'PAUSED',
    });

    const payload = expectMatchesContract(
      captureRequest(fetchMock),
      'ads.createAd'
    );
    expect(payload.adset_id).toBe('adset-1');
    expect(payload.creative).toEqual({ creative_id: 'creative-1' });
  });

  it('nests degrees_of_freedom_spec inside the creative for multi-destination ads', async () => {
    // Meta requires this INSIDE the ad-level creative object, not alongside it.
    // Getting it wrong is silently accepted and then under-delivers.
    await service.createAd({
      name: 'E2E Ad',
      adSetId: 'adset-1',
      creativeId: 'creative-1',
      status: 'PAUSED',
      degreesOfFreedomSpec: { creative_features_spec: {} },
    });

    const payload = expectMatchesContract(
      captureRequest(fetchMock),
      'ads.createAd'
    );
    const creative = payload.creative as Record<string, unknown>;

    expect(creative.degrees_of_freedom_spec).toEqual({
      creative_features_spec: {},
    });
    expect(payload.degrees_of_freedom_spec).toBeUndefined();
  });
});

describe('the detector actually fires', () => {
  it('rejects a payload carrying an undeclared field', () => {
    // A contract test that cannot fail is theatre. Prove the strict schema
    // catches the exact scenario this suite exists for.
    expect(() =>
      expectMatchesContract(
        {
          url: 'https://graph.facebook.com/v21.0/act_123456/campaigns',
          method: 'POST',
          endpointId: 'ads.createCampaign',
          body: {
            name: 'x',
            objective: 'OUTCOME_LEADS',
            status: 'PAUSED',
            special_ad_categories: [],
            buying_type: 'AUCTION',
            some_new_param: 'added without updating the contract',
          },
        },
        'ads.createCampaign'
      )
    ).toThrow(/some_new_param/);
  });
});

describe('createLeadGenForm', () => {
  it('satisfies the contract and stringifies the nested structures', async () => {
    await service.createLeadGenForm({
      name: 'E2E Lead Form',
      questions: [{ type: 'FULL_NAME' }, { type: 'EMAIL' }],
      privacyPolicy: { url: 'https://borradh.io/privacy' },
    });

    const payload = expectMatchesContract(
      captureRequest(fetchMock),
      'ads.createLeadGenForm'
    );

    // Meta wants JSON-IN-JSON here: real nested objects are rejected. A shape
    // that looks wrong and is right needs pinning, or someone "fixes" it.
    expect(typeof payload.questions).toBe('string');
    expect(typeof payload.privacy_policy).toBe('string');
    expect(JSON.parse(payload.questions as string)).toHaveLength(2);
    expect(JSON.parse(payload.privacy_policy as string)).toMatchObject({
      url: 'https://borradh.io/privacy',
    });
  });

  it('enables Messenger auto-start via is_auto_thread_creation_enabled + P2B_MESSENGER', async () => {
    // "Start conversations on Messenger" is driven by the top-level
    // is_auto_thread_creation_enabled flag plus a P2B_MESSENGER thank-you
    // button — verified by capturing the exact POST Meta Business Suite sends to
    // graph.facebook.com/{page}/leadgen_forms when the checkbox is ticked.
    // enable_messenger is never sent (noise); the hidden inbox_url question is a
    // server-side effect of the flag.
    await service.createLeadGenForm({
      name: 'E2E Lead Form',
      questions: [{ type: 'FULL_NAME' }],
      privacyPolicy: { url: 'https://borradh.io/privacy' },
    });

    const payload = expectMatchesContract(
      captureRequest(fetchMock),
      'ads.createLeadGenForm'
    );

    expect(payload.block_display_for_non_targeted_viewer).toBe(false);
    expect(payload.is_auto_thread_creation_enabled).toBe(true);
    expect(JSON.parse(payload.thank_you_page as string)).toMatchObject({
      button_type: 'P2B_MESSENGER',
    });
  });
});

describe('subscribeToLeadNotifications', () => {
  it('satisfies the page-subscription contract', async () => {
    await service.subscribeToLeadNotifications();

    const payload = expectMatchesContract(
      captureRequest(fetchMock),
      'pages.subscribeApp'
    );

    // The webhook fields are what make inbound leads and messages arrive at
    // all; an empty list is a silent outage.
    expect(payload.subscribed_fields).toBeDefined();
    expect(String(payload.subscribed_fields).length).toBeGreaterThan(0);
  });
});
