import { getAssetResponseSchema } from '@borradh-workspace/contracts';
import type {
  AdSnapshot,
  AdUpdateBlockedReason,
  UpdatableAdField,
} from '@borradh-workspace/contracts/ports';
import { z } from 'zod';
import {
  META_ADS_WRITE_PATHS,
  createMetaAdsPort,
} from '../../ports/meta-ads.adapter.js';
import { defineTool } from '../../tool-factory/index.js';

/** Owner-facing names for the fields the port reports on. */
const FIELD_LABELS: Record<UpdatableAdField, string> = {
  name: 'ad name',
  headline: 'headline',
  primaryText: 'caption',
  description: 'description',
  callToAction: 'call to action',
  destinationUrl: 'destination link',
};

function listFields(fields: readonly UpdatableAdField[]): string {
  return fields.map((f) => FIELD_LABELS[f]).join(', ');
}

/**
 * Is this ad ON META? Answered by `metaAdId`, which is the only thing that
 * knows — and the same test the service makes before it touches Meta at all
 * (`update-ad.service.ts`: `if (!ad.metaAdId) return ok(result)`).
 *
 * This distinction is load-bearing: the service edits live ads too (it mints a
 * fresh creative and swaps it onto the running ad), but every string in this
 * tool used to say "draft". Claire therefore signed off a live-ad edit with
 * "the ad is still a draft — nothing is live until you launch it" while the ad
 * was delivering and spending. (ENG-631)
 *
 * The first fix for that read `status !== 'draft'`, which is a DIFFERENT
 * question and gets a published ad right by accident. It is wrong in the other
 * direction for an ad Meta never accepted: a failed publish leaves `error`
 * with no `metaAdId`, and the tool would then report `live: true` and promise
 * a re-review of a running ad that does not exist. Prod carries such rows
 * today. `launching` and a pre-flight `pending` are wrong the same way.
 */
function isLiveOnMeta(ad: AdSnapshot): boolean {
  return ad.metaAdId !== null;
}

/**
 * Human sentence for each `AdUpdateBlockedReason`.
 *
 * Exhaustive over `kind` with no `default`, so adding a member to the union is
 * a compile error here rather than a vague "something went wrong" in chat.
 * (Destined for `../../ports/reason-messages.ts` alongside the others.)
 */
function describeAdUpdateBlocked(reason: AdUpdateBlockedReason): string {
  switch (reason.kind) {
    case 'ad_not_found':
      return `I couldn't find ad ${reason.adId} — it may have been deleted. Run listRecentAds and pick one that's still there.`;
    case 'ad_rejected':
      return 'That ad was rejected by Meta, so it can no longer be edited. I can create a fresh draft instead.';
    case 'creative_locked_to_existing_post':
      return 'That ad was built from an existing post, so Meta will only let us change its name — not the headline, caption, CTA or link.';
    case 'creative_media_missing':
      return "That ad was imported from Meta without its original video or image, so its creative can't be rebuilt. Create a new ad with the media you want.";
    case 'meta_sync_failed':
      return `Meta refused the change: ${reason.message}`;
    case 'other':
      return reason.message;
    case 'server_error':
      return 'Something went wrong on our side while updating the ad. Try again in a moment.';
  }
}

interface CreatedField {
  label: string;
  value: string;
}

interface UpdateAdOutput {
  uiState?: 'updated';
  title?: string;
  fields?: CreatedField[];
  adId?: string;
  name?: string;
  status?: string;
  /**
   * The fields the SERVER confirmed now hold the requested value. Absent on
   * any non-success. The old shape had no such list — it printed a card built
   * from the REQUEST, so a field the write never changed still read as changed.
   */
  updated?: UpdatableAdField[];
  /** Requested but NOT confirmed by the response. Never empty when present. */
  unchanged?: UpdatableAdField[];
  /**
   * The creative (image / video) is ALWAYS `'unchanged'` on a successful
   * updateAd. This tool edits copy fields only; the service rebuilds the
   * creative from the ad's EXISTING media refs, so an image/video swap is
   * impossible here by construction. Carried explicitly so the model can never
   * narrate a swap this tool did not make (#214) — to change the creative the
   * model must call `replaceAdCreative`.
   */
  creative?: 'unchanged';
  /**
   * Whether the edited ad is LIVE on Meta (it has a `metaAdId`). Carried
   * explicitly, like `creative`, so the model cannot narrate a running ad as
   * an unlaunched draft — the exact confabulation ENG-631 found in the wild.
   */
  live?: boolean;
  message?: string;
  preview?: {
    /**
     * `'launched'` is the renderer's word for "already on Meta" — it must match
     * `AdPreviewProps` in the chat card exactly. Emitting an unmodelled
     * `'live'` here would fall through the card's `variant === 'launched'`
     * check and draw a live ad as a draft, which is the bug this fixes.
     */
    variant: 'draft' | 'launched';
    /**
     * Always `'edit'` from this tool — it never launches anything. Without it
     * the card falls back to launch copy ("Submitted to Meta — the live status
     * could not be verified yet") on an ad that has been delivering for days.
     */
    context: 'edit';
    adName: string;
    headline?: string;
    primaryText?: string;
    callToAction?: string;
    destinationUrl?: string;
    videoId?: string;
    graphicId?: string;
    /** Direct urls for a library-asset creative — see {@link toPreview}. */
    assetImageUrl?: string;
    assetVideoUrl?: string;
    assetThumbnailUrl?: string;
  };
  error?: string;
}

/** The subset of `AdPreviewProps` that a resolved library asset fills in. */
interface ResolvedAssetMedia {
  assetImageUrl?: string;
  assetVideoUrl?: string;
  assetThumbnailUrl?: string;
}

/**
 * Built from the server's row, never from the request.
 *
 * `media` carries the RESOLVED urls for a library-asset creative. The card
 * polls `/videos/:id` or `/graphics/:id` for the ids below, and an ad built
 * from an uploaded photo holds an ASSET id in `videoId` — the ad wizard puts
 * it there (`select-video-step.tsx` sets `videoId` from videos, assets and
 * graphics alike). That poll 404s forever, so the card sat as a grey skeleton
 * and the owner never saw the edit they had just made. `createDraftAd` already
 * resolves this; this tool did not.
 */
function toPreview(
  ad: AdSnapshot,
  media: ResolvedAssetMedia = {}
): NonNullable<UpdateAdOutput['preview']> {
  return {
    ...media,
    variant: isLiveOnMeta(ad) ? 'launched' : 'draft',
    context: 'edit',
    adName: ad.name,
    ...(ad.headline ? { headline: ad.headline } : {}),
    ...(ad.primaryText ? { primaryText: ad.primaryText } : {}),
    ...(ad.callToAction ? { callToAction: ad.callToAction } : {}),
    ...(ad.destinationUrl ? { destinationUrl: ad.destinationUrl } : {}),
    ...(ad.videoId ? { videoId: ad.videoId } : {}),
    ...(ad.graphicId ? { graphicId: ad.graphicId } : {}),
  };
}

function toFields(ad: AdSnapshot, updated: UpdatableAdField[]): CreatedField[] {
  return [
    { label: 'Ad name', value: ad.name },
    ...(updated.includes('headline') && ad.headline
      ? [{ label: 'Headline', value: ad.headline }]
      : []),
    ...(updated.includes('primaryText') && ad.primaryText
      ? [
          {
            label: 'Caption',
            value:
              ad.primaryText.length > 220
                ? `${ad.primaryText.slice(0, 220)}…`
                : ad.primaryText,
          },
        ]
      : []),
    ...(updated.includes('callToAction') && ad.callToAction
      ? [
          {
            label: 'Call to action',
            value: ad.callToAction.replace(/_/g, ' ').toLowerCase(),
          },
        ]
      : []),
    {
      label: 'Status',
      // Read from the ad, not hardcoded. This line said "Draft — not running
      // yet" on EVERY result, including the payload that also carried
      // `live: true` and `status: "active"` — the model was handed the same
      // contradiction this tool exists to remove. (ENG-631)
      value: isLiveOnMeta(ad)
        ? 'Live on Meta — Meta re-reviews an edited ad before it delivers again'
        : 'Draft — not running yet',
    },
  ];
}

/**
 * `meta_ads_updateAd` — edit an EXISTING ad in place, draft OR live.
 *
 * This is the iteration tool: when the operator asks to tweak an ad they have
 * already seen ("change the headline", "shorten the caption", "make the CTA
 * Book Now"), the assistant edits the SAME ad row rather than calling
 * `createDraftAd` again. Re-creating a draft on every edit is what left a
 * campaign holding both the old and the new ads (3 → 6) and diluted the
 * launched budget. `updateAd` mutates in place, so the count never grows.
 *
 * LIVE ADS ARE IN SCOPE. The service does not stop at the local row: for an ad
 * with a `metaAdId` it builds a new creative (Meta creatives are immutable) and
 * swaps it onto the RUNNING ad, so a copy edit reaches a delivering ad. The
 * output carries `live: true` in that case and the message explains that Meta
 * re-reviews an edited ad. Everything here used to say "draft" unconditionally,
 * which is why Claire closed a live-ad edit with "nothing is live until you
 * launch it" while the ad was spending (ENG-631). Only `draft` means unpublished.
 *
 * It never publishes an unpublished ad and never starts spend on its own.
 * Use `replaceAdCreative` to swap an ad's video/graphic.
 *
 * TARGETING WAS REMOVED, on purpose. The old input took a `targetingOverride`
 * and reported success for it. `PUT /meta-ads/:id` writes that JSON to the ad
 * row and nothing that reaches Meta ever reads it: the service pushes only
 * `{ name, creative }` to the Marketing API, and `publishAd` resolves an
 * EXISTING ad set rather than deriving targeting from the row. Delivery
 * targeting lives on the Meta ad set. So "target 25-40 within 10km" was
 * accepted, acknowledged, and changed nothing anyone would ever see — the
 * silent no-op this port exists to make unrepresentable.
 */
export const updateAdTool = defineTool<
  {
    adId: string;
    name?: string;
    headline?: string;
    primaryText?: string;
    description?: string;
    callToAction?:
      | 'LEARN_MORE'
      | 'SHOP_NOW'
      | 'SIGN_UP'
      | 'CONTACT_US'
      | 'WATCH_MORE'
      | 'BOOK_NOW'
      | 'GET_QUOTE'
      | 'SUBSCRIBE'
      | 'DOWNLOAD'
      | 'GET_OFFER';
    destinationUrl?: string;
  },
  UpdateAdOutput
>({
  feature: 'meta-ads',
  action: 'updateAd',
  description:
    'Edit an EXISTING ad in place — headline, primary text, description, ' +
    'CTA, or name. Works on DRAFT ads AND on LIVE ads already running on ' +
    'Meta: for a live ad the new copy is pushed to the running ad and the ' +
    'result reports live: true, so say the change is live and that Meta ' +
    're-reviews an edited ad before it delivers again. Never call a live ad ' +
    'a draft. Use this for tweaks to an ad the operator has ' +
    'already seen, INSTEAD of calling createDraftAd again (which would leave ' +
    'the old ad in the campaign alongside the new one). Pass only the fields ' +
    'that change. This tool CANNOT change targeting (age, radius, countries) — ' +
    'that lives on the campaign ad set, not the ad. This tool CANNOT change ' +
    'the image or video either — the result always reports `creative: ' +
    '"unchanged"`, so never tell the user you swapped the picture from here. ' +
    'To swap the creative use replaceAdCreative; to remove it use ' +
    'deleteDraftAd. Use listRecentAds to find the ad ID.',
  inputSchema: z.object({
    adId: z
      .string()
      .min(1)
      .describe('The ad ID to edit in place (draft or live)'),
    name: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .describe('Ad name (internal label, max 255 chars)'),
    headline: z
      .string()
      .max(80)
      .optional()
      .describe('Ad headline (max 80 chars)'),
    primaryText: z
      .string()
      .max(500)
      .optional()
      .describe('Ad primary text / caption (max 500 chars)'),
    description: z
      .string()
      .max(30)
      .optional()
      .describe('Ad description (max 30 chars)'),
    callToAction: z
      .enum([
        'LEARN_MORE',
        'SHOP_NOW',
        'SIGN_UP',
        'CONTACT_US',
        'WATCH_MORE',
        'BOOK_NOW',
        'GET_QUOTE',
        'SUBSCRIBE',
        'DOWNLOAD',
        'GET_OFFER',
      ])
      .optional()
      .describe('Call-to-action button'),
    // `.url()` matches the API's own `updateAdSchema`. Without it the model's
    // malformed link round-tripped into a 400 the owner saw as "update failed".
    destinationUrl: z
      .string()
      .url()
      .optional()
      .describe('Landing page URL for the ad'),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Updating ad' },
  additionalAllowedPaths: META_ADS_WRITE_PATHS,
  execute: async ({ adId, ...changes }, ctx) => {
    // `ctx.ports.metaAds` is composed over the SHARED apiFetch, whose whitelist
    // deliberately excludes `PUT /meta-ads/:id`. Inside a wrapped execute
    // `ctx.apiFetch` already carries this tool's `additionalAllowedPaths`, so
    // the port is composed over that instead. Identical adapter and identical
    // union — the composition root can take this over the moment it threads a
    // path-extended fetch into `buildAssistantPorts`.
    const metaAds = createMetaAdsPort({
      apiFetch: ctx.apiFetch,
      organizationId: ctx.organizationId,
    });
    const result = await metaAds.updateAd({ adId, ...changes });

    if (result.status === 'blocked') {
      if (result.reason.kind === 'server_error') {
        ctx.reportIssue('Failed to update ad', {
          extra: { adId, reason: result.reason },
        });
      }
      return { data: { error: describeAdUpdateBlocked(result.reason) } };
    }

    if (result.status === 'saved_but_not_synced') {
      // Both halves survive: the draft in Borradh changed, the live ad did not.
      // Collapsing this into a plain error hid the first half; collapsing it
      // into a success hid the second.
      if (result.reason.kind === 'server_error') {
        ctx.reportIssue('Failed to sync ad update to Meta', {
          extra: { adId, reason: result.reason },
        });
      }
      return {
        data: {
          adId: result.adId,
          error: `I saved the ${listFields(result.requested)} in Borradh, but the live ad on Meta was NOT updated. ${describeAdUpdateBlocked(result.reason)}`,
        },
      };
    }

    const { ad, updated } = result;
    const live = isLiveOnMeta(ad);

    // Resolve a library-asset creative so the card can render it directly.
    // Best-effort, exactly as `createDraftAd` does it: the edit has already
    // landed, and a failed lookup must cost the owner a picture, not the
    // result. `videoId` may be a video id OR an asset id — ask for the asset
    // and treat a miss as "it was a real video after all".
    const media: ResolvedAssetMedia = {};
    const assetId = ad.videoId;
    if (assetId) {
      try {
        const assetRecord = await ctx.apiFetch(`assets/${assetId}`, {
          schema: getAssetResponseSchema,
        });
        if (assetRecord.type === 'image') {
          if (assetRecord.blobUrl) media.assetImageUrl = assetRecord.blobUrl;
        } else {
          if (assetRecord.blobUrl) media.assetVideoUrl = assetRecord.blobUrl;
          if (assetRecord.thumbnailUrl)
            media.assetThumbnailUrl = assetRecord.thumbnailUrl;
        }
      } catch {
        // Not an asset (a rendered video/graphic id) or unreadable — the card
        // polls for those by id, which is correct for them.
      }
    }
    // A copy edit on a live ad cannot reuse the old creative — Meta creatives
    // are immutable, so the service builds a NEW one and swaps it onto the
    // running ad. That swap sends the ad back through Meta's review, which is
    // the one consequence an owner must hear about before it surprises them.
    const liveNote = live
      ? 'This ad is live on Meta, so the change is already on the running ad — Meta re-reviews an edited ad before it delivers again, which usually takes a short while. Delivery can pause until that clears.'
      : undefined;
    const base = {
      uiState: 'updated' as const,
      title: `Updated ${live ? 'live' : 'draft'} ad: ${ad.name}`,
      fields: toFields(ad, updated),
      adId: ad.adId,
      name: ad.name,
      status: ad.status,
      updated,
      // The creative is never touched here — state it so the model can't
      // report an image/video swap this tool did not make (#214).
      creative: 'unchanged' as const,
      // Same reasoning as `creative`: state it, so the model cannot invent
      // draft semantics for an ad that is already delivering (ENG-631).
      live,
      preview: toPreview(ad, media),
    };

    if (result.status === 'partially_updated') {
      const partialNote = `The ad now shows the ${updated.length > 0 ? `${listFields(updated)} you asked for, but the ` : ''}${listFields(result.unchanged)} did not change — the ad still has its previous value. Ask me to try that part again.`;
      return {
        presentation: { type: 'ad_preview' as const },
        data: {
          ...base,
          unchanged: result.unchanged,
          message: liveNote ? `${partialNote} ${liveNote}` : partialNote,
        },
      };
    }

    return {
      presentation: { type: 'ad_preview' as const },
      data: liveNote ? { ...base, message: liveNote } : base,
    };
  },
});
