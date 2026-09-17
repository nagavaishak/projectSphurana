import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { buildAdCreative } from './build-ad-creative.js';

/**
 * Regression coverage for the lead-form creative path. The bug: image (graphic)
 * ads in an OUTCOME_LEADS campaign were created WITHOUT the instant form on the
 * creative CTA, so Meta rejected them with 100/3390001 ("Choose or create an
 * instant form for your leads campaign") — while video ads in the same campaign
 * published fine. These tests assert both paths carry `leadGenFormId`.
 */

const META_FORM_ID = 'meta-form-123';

function makeMetaService() {
  return {
    createAdCreativeFromImage: vi.fn().mockResolvedValue('img-creative-1'),
    createAdCreative: vi.fn().mockResolvedValue('vid-creative-1'),
    getVideoStatus: vi.fn().mockResolvedValue({
      status: 'ready',
      isReady: true,
      thumbnailUrl: 'https://thumb.example/from-meta.jpg',
    }),
  };
}

function makeDb() {
  return {
    query: {
      // No destinationUrl override path needed — ad rows below set one.
      organization: {
        findFirst: vi.fn().mockResolvedValue({ websiteUrl: null }),
      },
      leadForm: {
        findFirst: vi.fn().mockResolvedValue({ metaFormId: META_FORM_ID }),
      },
    },
  };
}

const baseAdRecord = {
  id: 'ad-1',
  name: 'Body Contouring — Graphic Ad',
  leadFormId: 'lf-1',
  callToAction: 'SIGN_UP',
  primaryText: 'Primary',
  headline: 'Headline',
  description: 'Desc',
  destinationUrl: 'https://clinic.example',
  adPlacement: 'facebook',
  videoId: null,
  graphicId: null,
};

const resolvedPage = { pageId: 'page-1', linkedInstagramAccountId: null };

describe('buildAdCreative — lead form on creative CTA', () => {
  beforeEach(() => vi.clearAllMocks());

  it('attaches lead_gen_form_id to the IMAGE creative for a leads campaign', async () => {
    const metaService = makeMetaService();
    const db = makeDb();

    const result = await buildAdCreative(db as never, metaService as never, {
      adRecord: { ...baseAdRecord, graphicId: 'g1' } as never,
      organizationId: 'org-1',
      resolvedPage,
      metaImageHash: 'hash-abc',
      campaignObjective: 'OUTCOME_LEADS',
      adSetDestinationType: 'WEBSITE',
    });

    expect(result.success).toBe(true);
    expect(metaService.createAdCreativeFromImage).toHaveBeenCalledTimes(1);
    const config = metaService.createAdCreativeFromImage.mock.calls[0][0];
    expect(
      config.objectStorySpec.linkData.callToAction.value.leadGenFormId
    ).toBe(META_FORM_ID);
  });

  it('attaches lead_gen_form_id to the VIDEO creative (existing behaviour)', async () => {
    const metaService = makeMetaService();
    const db = makeDb();

    const result = await buildAdCreative(db as never, metaService as never, {
      adRecord: { ...baseAdRecord, videoId: 'v1' } as never,
      organizationId: 'org-1',
      resolvedPage,
      metaVideoId: 'meta-vid-1',
      videoThumbnailUrl: 'https://thumb.example/x.jpg',
      campaignObjective: 'OUTCOME_LEADS',
      adSetDestinationType: 'WEBSITE',
    });

    expect(result.success).toBe(true);
    expect(metaService.createAdCreative).toHaveBeenCalledTimes(1);
    const config = metaService.createAdCreative.mock.calls[0][0];
    expect(
      config.objectStorySpec.videoData.callToAction.value.leadGenFormId
    ).toBe(META_FORM_ID);
  });

  /**
   * Meta rejects a `video_data` creative carrying neither `image_hash` nor
   * `image_url`. The caller passes the thumbnail it got at upload time — but
   * Meta doesn't always have one ready that soon, so `finalize-ad` can persist
   * a null `metaThumbnailUrl`. The ad still LAUNCHES; every later EDIT then
   * rebuilds the creative from that null column and Meta refuses it, leaving
   * the ad permanently uneditable ("Failed to sync ad update to Meta: Please
   * specify one of image_hash or image_url in the video_data field of
   * object_story_spec"). The builder must fetch the thumbnail itself rather
   * than trust the caller to have one.
   */
  it('fetches the video thumbnail from Meta when the caller has none', async () => {
    const metaService = makeMetaService();
    const db = makeDb();

    const result = await buildAdCreative(db as never, metaService as never, {
      adRecord: { ...baseAdRecord, videoId: 'v1' } as never,
      organizationId: 'org-1',
      resolvedPage,
      metaVideoId: 'meta-vid-1',
      // videoThumbnailUrl deliberately absent — this is the edit path reading a
      // null metaThumbnailUrl off the ad row.
      campaignObjective: 'OUTCOME_LEADS',
      adSetDestinationType: 'WEBSITE',
    });

    expect(result.success).toBe(true);
    expect(metaService.getVideoStatus).toHaveBeenCalledWith('meta-vid-1');
    const config = metaService.createAdCreative.mock.calls[0][0];
    expect(config.objectStorySpec.videoData.imageUrl).toBe(
      'https://thumb.example/from-meta.jpg'
    );
  });

  it('does not re-fetch the thumbnail when the caller already has one', async () => {
    const metaService = makeMetaService();
    const db = makeDb();

    await buildAdCreative(db as never, metaService as never, {
      adRecord: { ...baseAdRecord, videoId: 'v1' } as never,
      organizationId: 'org-1',
      resolvedPage,
      metaVideoId: 'meta-vid-1',
      videoThumbnailUrl: 'https://thumb.example/from-upload.jpg',
      campaignObjective: 'OUTCOME_LEADS',
      adSetDestinationType: 'WEBSITE',
    });

    expect(metaService.getVideoStatus).not.toHaveBeenCalled();
    const config = metaService.createAdCreative.mock.calls[0][0];
    expect(config.objectStorySpec.videoData.imageUrl).toBe(
      'https://thumb.example/from-upload.jpg'
    );
  });
});

/**
 * Contract coverage for the messaging-aware CTA / destination handling. These
 * invariants caused real Meta rejections that only this builder enforces, and
 * were previously untested (the suite above only covered the happy lead-form
 * path). Each case pins one rejection class so a refactor can't silently
 * reintroduce it. The ad-set `destination_type` (not the ad row's followUpType)
 * is the source of truth — see build-ad-creative.ts.
 */
describe('buildAdCreative — messaging & CTA contracts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('messaging image creative links to the Page and carries NO website link on the CTA (100/1487891)', async () => {
    const metaService = makeMetaService();
    const db = makeDb();

    const result = await buildAdCreative(db as never, metaService as never, {
      adRecord: { ...baseAdRecord, graphicId: 'g1' } as never,
      organizationId: 'org-1',
      resolvedPage,
      metaImageHash: 'hash-abc',
      campaignObjective: 'OUTCOME_ENGAGEMENT',
      adSetDestinationType: 'MESSENGER',
    });

    expect(result.success).toBe(true);
    expect(metaService.createAdCreativeFromImage).toHaveBeenCalledTimes(1);
    const call = metaService.createAdCreativeFromImage.mock.calls[0][0];
    const linkData = call.objectStorySpec.linkData;
    // Top-level link must be the neutral Page, not the clinic website.
    expect(linkData.link).toBe('https://www.facebook.com/page-1');
    // A website link in the CTA value reads as traffic and Meta rejects the
    // messaging creative — the working path sends no link here.
    expect(linkData.callToAction.value.link).toBeUndefined();
    expect(linkData.callToAction.type).toBe('MESSAGE_PAGE');
    // Messaging creatives opt out of automatic creative features.
    expect(call.degreesOfFreedomSpec).toBeDefined();
  });

  it('WhatsApp messaging creative uses WHATSAPP_MESSAGE + app_destination and no link', async () => {
    const metaService = makeMetaService();
    const db = makeDb();

    const result = await buildAdCreative(db as never, metaService as never, {
      adRecord: { ...baseAdRecord, graphicId: 'g1' } as never,
      organizationId: 'org-1',
      resolvedPage,
      metaImageHash: 'hash-abc',
      campaignObjective: 'OUTCOME_ENGAGEMENT',
      adSetDestinationType: 'WHATSAPP',
    });

    expect(result.success).toBe(true);
    const cta =
      metaService.createAdCreativeFromImage.mock.calls[0][0].objectStorySpec
        .linkData.callToAction;
    expect(cta.type).toBe('WHATSAPP_MESSAGE');
    expect(cta.value.appDestination).toBe('WHATSAPP');
    expect(cta.value.link).toBeUndefined();
  });

  it('multi-destination messaging carries asset_feed_spec + degrees_of_freedom_spec (100/2446493)', async () => {
    const metaService = makeMetaService();
    const db = makeDb();

    const result = await buildAdCreative(db as never, metaService as never, {
      adRecord: { ...baseAdRecord, graphicId: 'g1' } as never,
      organizationId: 'org-1',
      resolvedPage,
      metaImageHash: 'hash-abc',
      campaignObjective: 'OUTCOME_ENGAGEMENT',
      adSetDestinationType: 'MESSAGING_INSTAGRAM_DIRECT_MESSENGER',
    });

    expect(result.success).toBe(true);
    const call = metaService.createAdCreativeFromImage.mock.calls[0][0];
    expect(call.assetFeedSpec?.optimization_type).toBe(
      'DOF_MESSAGING_DESTINATION'
    );
    expect(call.degreesOfFreedomSpec).toBeDefined();
    // The same spec is returned so the caller can reuse it on the ad object.
    if (result.success) {
      expect(result.data.degreesOfFreedomSpec).toBeDefined();
    }
  });

  it('traffic creative (no lead form) carries the destination link and no lead_gen_form_id', async () => {
    const metaService = makeMetaService();
    const db = makeDb();

    const result = await buildAdCreative(db as never, metaService as never, {
      adRecord: {
        ...baseAdRecord,
        graphicId: 'g1',
        leadFormId: null,
        callToAction: 'LEARN_MORE',
      } as never,
      organizationId: 'org-1',
      resolvedPage,
      metaImageHash: 'hash-abc',
      campaignObjective: 'OUTCOME_TRAFFIC',
      adSetDestinationType: 'WEBSITE',
    });

    expect(result.success).toBe(true);
    const call = metaService.createAdCreativeFromImage.mock.calls[0][0];
    const cta = call.objectStorySpec.linkData.callToAction;
    expect(cta.type).toBe('LEARN_MORE');
    expect(cta.value.link).toBe('https://clinic.example');
    expect(cta.value.leadGenFormId).toBeUndefined();
    // Non-messaging traffic ads don't opt out of creative features.
    expect(call.degreesOfFreedomSpec).toBeUndefined();
  });

  it('coerces an invalid requested CTA to SIGN_UP on a lead-form creative (100/1856030)', async () => {
    const metaService = makeMetaService();
    const db = makeDb();

    const result = await buildAdCreative(db as never, metaService as never, {
      // CONTACT_US is not a valid lead-form CTA; the builder must coerce it.
      adRecord: {
        ...baseAdRecord,
        graphicId: 'g1',
        callToAction: 'CONTACT_US',
      } as never,
      organizationId: 'org-1',
      resolvedPage,
      metaImageHash: 'hash-abc',
      campaignObjective: 'OUTCOME_LEADS',
      adSetDestinationType: 'WEBSITE',
    });

    expect(result.success).toBe(true);
    const cta =
      metaService.createAdCreativeFromImage.mock.calls[0][0].objectStorySpec
        .linkData.callToAction;
    expect(cta.type).toBe('SIGN_UP');
    expect(cta.value.leadGenFormId).toBe(META_FORM_ID);
  });
});
