import {
  leadForm,
  type metaAd,
  organization,
} from '@borradh-workspace/database';
import type {
  MetaAdsService,
  MetaAssetFeedSpec,
  MetaCallToActionType,
  MetaDegreesOfFreedomSpec,
} from '@borradh-workspace/integrations/meta-ads';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';

/**
 * Single source of truth for turning one of our `metaAd` rows + an uploaded
 * Meta asset (video id OR image hash) into a Meta ad CREATIVE.
 *
 * Previously `finalizeAd` (the launchAd path) and `publishAd` (the draft →
 * publish path) each built the `object_story_spec` independently. They drifted:
 * `publishAd`'s image branch hardcoded a `LEARN_MORE` link CTA, which made
 * image/offer creatives INCOMPATIBLE with a messaging campaign objective
 * (Meta error 100/1487891) — while video slipped through because it left the
 * CTA unset and let Meta infer the ad set's messaging destination. It also
 * dropped the Instagram actor and the objective-gated multi-destination spec.
 *
 * Consolidating both onto this builder fixes that class of bug at the source:
 * the CTA is messaging-aware, the IG actor is always attached, and image and
 * video share identical destination/objective handling.
 *
 * Scope: this builds and creates the CREATIVE only. Creating the ad object
 * (PAUSED-then-activate vs ACTIVE) and the surrounding DB writes stay in each
 * caller, because those genuinely differ between the two flows.
 */

type AdRecord = typeof metaAd.$inferSelect;

interface ResolvedPageLike {
  pageId: string;
  linkedInstagramAccountId?: string | null;
}

export interface BuildAdCreativeArgs {
  adRecord: AdRecord;
  organizationId: string;
  resolvedPage: ResolvedPageLike;
  /** From the upload step — exactly one of these is set. */
  metaVideoId?: string | null;
  metaImageHash?: string | null;
  /** Video thumbnail (video creatives only). */
  videoThumbnailUrl?: string;
  /**
   * Campaign objective, when the caller already fetched it. Omit and the
   * builder fetches it.
   */
  campaignObjective?: string;
  /**
   * The ad set's Meta `destination_type` (e.g. 'MESSENGER', 'WHATSAPP',
   * 'MESSAGING_INSTAGRAM_DIRECT_MESSENGER'), when the caller already fetched it.
   * THIS is the source of truth for whether the creative must be a messaging
   * (click-to-message) creative — the ad row's `followUpType` is unreliable.
   * Omit and the builder fetches it from the campaign's ad sets.
   */
  adSetDestinationType?: string;
}

export interface BuiltAdCreative {
  creativeId: string;
  /**
   * The degrees-of-freedom spec used on the creative — the caller passes the
   * SAME spec when it creates the ad object, so it's returned here.
   */
  degreesOfFreedomSpec?: MetaDegreesOfFreedomSpec;
}

/**
 * Build + create the Meta ad creative for an ad row. Returns the creative id
 * (and the degrees-of-freedom spec to reuse on the ad). Errors are returned as
 * `Result` so callers can record them on the ad row (`setAdError`).
 */
export const buildAdCreative = async (
  db: DbConnection,
  metaService: MetaAdsService,
  args: BuildAdCreativeArgs
): Promise<Result<BuiltAdCreative>> => {
  const { adRecord, organizationId, resolvedPage, metaVideoId, metaImageHash } =
    args;

  // ── Video thumbnail: required by Meta, and NOT always known by the caller ──
  //
  // Meta rejects a `video_data` creative that carries neither `image_hash` nor
  // `image_url` ("Please specify one of image_hash or image_url in the
  // video_data field of object_story_spec"). The caller normally passes the
  // thumbnail it got back when it uploaded the video — but Meta does not always
  // have one ready that soon, in which case `finalize-ad` persists no
  // `metaThumbnailUrl` at all. The ad LAUNCHES fine (the upload response
  // carried a thumbnail, or Meta filled one in), and then every later EDIT of
  // that ad rebuilds the creative from a null column and is rejected — the ad is
  // permanently uneditable, and the user just sees "Failed to sync ad update to
  // Meta".
  //
  // So don't trust the caller to have it: if this is a video creative and no
  // thumbnail came in, ask Meta for the one it generated. By the time an ad is
  // being edited the video is long since processed, so this is a single cheap
  // read.
  let videoThumbnailUrl = args.videoThumbnailUrl;
  if (metaVideoId && !videoThumbnailUrl) {
    try {
      const status = await metaService.getVideoStatus(metaVideoId);
      videoThumbnailUrl = status.thumbnailUrl;
    } catch {
      // Non-fatal here: fall through and let Meta's own validation speak, so
      // the failure carries Meta's message rather than one we invented.
    }
  }

  // ── Destination link: ad override → org website → Page fallback ──────────
  let resolvedDestinationUrl = adRecord.destinationUrl;
  if (!resolvedDestinationUrl) {
    const org = await db.query.organization.findFirst({
      where: and(eq(organization.id, organizationId), notDeleted(organization)),
      columns: { websiteUrl: true },
    });
    resolvedDestinationUrl = org?.websiteUrl ?? null;
  }
  const pageId = resolvedPage.pageId;
  const link = resolvedDestinationUrl || `https://www.facebook.com/${pageId}`;

  // Whether this creative must be a MESSAGING (click-to-message) creative is
  // decided by the AD SET's destination_type + the campaign objective — NOT the
  // ad row's `followUpType`. The campaign builder leaves `followUpType` as
  // 'lead_form' even on click-to-Messenger campaigns, so trusting it produced a
  // traffic CTA (BOOK_NOW) on a messaging ad set. Meta tolerates that for
  // `video_data` but rejects it for image `link_data` as incompatible with the
  // objective (100/1487891) — exactly why image offer ads failed.
  let campaignObjective = args.campaignObjective;
  let adSetDestinationType = args.adSetDestinationType;
  if (
    adRecord.metaCampaignId &&
    (campaignObjective === undefined || adSetDestinationType === undefined)
  ) {
    try {
      const [campaign, adSets] = await Promise.all([
        campaignObjective === undefined
          ? metaService.getCampaign(adRecord.metaCampaignId)
          : Promise.resolve(null),
        adSetDestinationType === undefined && adRecord.metaAdSetId
          ? metaService.listAdSets(adRecord.metaCampaignId)
          : Promise.resolve(null),
      ]);
      if (campaign) campaignObjective = campaign.objective;
      if (adSets) {
        adSetDestinationType = adSets.find(
          (s) => s.id === adRecord.metaAdSetId
        )?.destinationType;
      }
    } catch {
      // Non-fatal — fall back to followUpType-based handling below.
    }
  }

  // Messaging destination types Meta exposes on the ad set.
  const MESSAGING_DESTINATIONS = new Set([
    'MESSENGER',
    'INSTAGRAM_DIRECT',
    'WHATSAPP',
    'MESSAGING_MESSENGER_WHATSAPP',
    'MESSAGING_INSTAGRAM_DIRECT_MESSENGER',
    'MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP',
  ]);
  const destIsMessaging = adSetDestinationType
    ? MESSAGING_DESTINATIONS.has(adSetDestinationType)
    : false;
  // Fall back to followUpType only when we couldn't read the ad set destination.
  const isMessaging = destIsMessaging || adRecord.followUpType === 'chatbot';
  const isWhatsApp =
    adSetDestinationType === 'WHATSAPP' ||
    adRecord.conversionDestination === 'whatsapp';
  // A combo destination (Messenger + IG Direct ± WhatsApp) needs asset_feed_spec.
  // Prefer the ad set's real destination_type; fall back to the objective
  // heuristic when we couldn't read it (e.g. it isn't available).
  const isMultiDestination = adSetDestinationType
    ? adSetDestinationType.startsWith('MESSAGING_')
    : isMessaging && !isWhatsApp && campaignObjective === 'OUTCOME_ENGAGEMENT';

  // Messaging creatives opt out of automatic creative features. Multi-
  // destination ads MUST carry a degrees_of_freedom_spec on the creative —
  // Meta rejects the ad otherwise ("Creative should have degrees_of_freedom
  // spec for multi-destination ads", code 100/2446493, ENG-254). isMultiDestination
  // implies isMessaging today, but tie the spec to both so the invariant holds
  // even if the destination/objective heuristics shift.
  const degreesOfFreedomSpec: MetaDegreesOfFreedomSpec | undefined =
    isMessaging || isMultiDestination
      ? {
          creative_features_spec: {
            image_touchups: { enroll_status: 'OPT_OUT' },
            image_templates: { enroll_status: 'OPT_OUT' },
            inline_comment: { enroll_status: 'OPT_OUT' },
            text_optimizations: { enroll_status: 'OPT_OUT' },
            adapt_to_placement: { enroll_status: 'OPT_OUT' },
          },
        }
      : undefined;

  // Multi-destination messaging ads also need asset_feed_spec listing the
  // available messaging platforms.
  const assetFeedSpec: MetaAssetFeedSpec | undefined = isMultiDestination
    ? {
        optimization_type: 'DOF_MESSAGING_DESTINATION',
        call_to_actions: [
          {
            type: 'MESSAGE_PAGE',
            value: {
              app_destination: 'MESSENGER',
              link: `https://www.facebook.com/${pageId}`,
            },
          },
          {
            type: 'INSTAGRAM_MESSAGE',
            value: {
              app_destination: 'INSTAGRAM_DIRECT',
              link: 'https://www.instagram.com',
            },
          },
        ],
      }
    : undefined;

  // ── Resolve the CTA (messaging-aware) ────────────────────────────────────
  const ctaValue: {
    link?: string;
    leadGenFormId?: string;
    appDestination?: string;
  } = {};
  let ctaType: MetaCallToActionType;

  if (isMessaging) {
    if (isWhatsApp) {
      ctaType = 'WHATSAPP_MESSAGE';
      ctaValue.appDestination = 'WHATSAPP';
    } else {
      ctaType = 'MESSAGE_PAGE';
      // Single-destination OUTCOME_LEADS needs an explicit appDestination;
      // multi-destination / OUTCOME_ENGAGEMENT omit it (Meta routes, or the
      // asset_feed_spec carries the destinations).
      if (campaignObjective === 'OUTCOME_LEADS' && !isMultiDestination) {
        ctaValue.appDestination = 'MESSENGER';
      }
    }
  } else if (adRecord.leadFormId) {
    const leadFormRecord = await db.query.leadForm.findFirst({
      where: eq(leadForm.id, adRecord.leadFormId),
      columns: { metaFormId: true },
    });
    if (!leadFormRecord?.metaFormId) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Lead form has not been synced to Meta. Please sync the lead form first.'
        )
      );
    }
    // A lead_gen_form_id creative only accepts this exact set of CTA types
    // (Meta Marketing API — "Lead Forms for Ads"). Anything else (e.g.
    // CONTACT_US, BOOK_NOW, which AI-generated ad copy can pick) is rejected
    // with error 100/1856030, so coerce it to a valid lead CTA.
    const LEAD_FORM_VALID_CTAS = new Set<MetaCallToActionType>([
      'APPLY_NOW',
      'DOWNLOAD',
      'GET_QUOTE',
      'LEARN_MORE',
      'SIGN_UP',
      'SUBSCRIBE',
    ]);
    const requestedCta = adRecord.callToAction as MetaCallToActionType;
    ctaType = LEAD_FORM_VALID_CTAS.has(requestedCta) ? requestedCta : 'SIGN_UP';
    ctaValue.leadGenFormId = leadFormRecord.metaFormId;
    ctaValue.link = link;
  } else {
    ctaType = adRecord.callToAction as MetaCallToActionType;
    ctaValue.link = link;
  }

  // ── Instagram actor (required when placement includes Instagram) ─────────
  const adPlacement = adRecord.adPlacement;
  const needsInstagram = adPlacement === 'instagram' || adPlacement === 'both';
  const instagramActorId = needsInstagram
    ? (resolvedPage.linkedInstagramAccountId ?? undefined)
    : undefined;

  if (needsInstagram && !instagramActorId) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'No Instagram Business Account linked to the Facebook Page used for this ad. Link an Instagram account in Facebook Page Settings.'
      )
    );
  }

  // ── Build + create the creative (image vs video) ─────────────────────────
  // A Meta error here propagates (it carries the user-facing message); each
  // caller already wraps creative creation in its own try/catch + setAdError.
  const isImage = Boolean(metaImageHash && !metaVideoId);

  // `link_data` REQUIRES a `link`, but for a messaging ad a website link reads
  // as a traffic signal and Meta rejects the creative as incompatible with the
  // messaging objective (the working video creative carries no link at all). So
  // for messaging ads the image link is the PAGE, not the website.
  const imageLink = isMessaging ? `https://www.facebook.com/${pageId}` : link;

  const creativeId = isImage
    ? await metaService.createAdCreativeFromImage({
        name: `${adRecord.name} - Creative`,
        objectStorySpec: {
          pageId,
          instagramActorId,
          linkData: {
            // biome-ignore lint/style/noNonNullAssertion: image branch guarantees hash
            imageHash: metaImageHash!,
            message: adRecord.primaryText ?? undefined,
            name: adRecord.headline ?? undefined,
            description: adRecord.description ?? undefined,
            // Top-level link is REQUIRED by Meta; for messaging it's the Page
            // (a neutral value), for traffic/leads it's the destination.
            link: imageLink,
            // The CTA VALUE must NOT carry a website link for a messaging CTA —
            // a link there makes Meta classify the creative as traffic, which is
            // incompatible with a messaging objective (the working video sends
            // an empty value here). `ctaValue.link` is only set for non-chatbot
            // ads, so messaging ads correctly send app_destination / nothing.
            callToAction: {
              type: ctaType,
              value: {
                link: ctaValue.link,
                // Lead-form ads MUST carry the instant form on the creative CTA
                // (Meta error 3390001 otherwise) — the video path already does.
                leadGenFormId: ctaValue.leadGenFormId,
                appDestination: ctaValue.appDestination,
              },
            },
          },
        },
        degreesOfFreedomSpec,
        assetFeedSpec,
      })
    : await metaService.createAdCreative({
        name: `${adRecord.name} - Creative`,
        objectStorySpec: {
          pageId,
          instagramActorId,
          videoData: {
            // biome-ignore lint/style/noNonNullAssertion: video branch guarantees id
            videoId: metaVideoId!,
            imageUrl: videoThumbnailUrl,
            title: adRecord.headline ?? undefined,
            message: adRecord.primaryText ?? undefined,
            linkDescription: adRecord.description ?? undefined,
            callToAction: { type: ctaType, value: ctaValue },
          },
        },
        degreesOfFreedomSpec,
        assetFeedSpec,
      });

  return ok({ creativeId, degreesOfFreedomSpec });
};
