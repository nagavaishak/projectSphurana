import { getAssetResponseSchema } from '@borradh-workspace/contracts';
import { db } from '@borradh-workspace/database';
import { getOrgDefaults } from '@borradh-workspace/features/org-defaults';
import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';
import {
  type AssetUnresolvedOutput,
  resolveAssetReference,
} from '../_shared/asset-ref.js';
import { resolveCampaignBudgetDisplay } from './_shared/budget-display.js';
import { resolveAdTargeting } from './_shared/targeting.js';
import { LAUNCH_AD_HARD_BLOCKS } from './confirm-launch-ad.tool.js';

const safeExternalId = z.string().regex(/^[\w-]+$/, 'Invalid ID format');

interface CreateDraftAdApiResponse {
  id: string;
  name: string;
  status: string;
  metaCampaignId: string;
}

interface CreatedField {
  label: string;
  value: string;
}

/**
 * Output payload — frontend renders a rich `AdPreviewCard` (see
 * `apps/app/.../rich/ad-preview-card.tsx`) when the `uiState: 'created'`
 * shape carries the ad-preview fields below. The plain `fields` list is
 * kept too so older renderers / fallback paths still get a definition list.
 */
interface CreateDraftAdOutput {
  uiState?: 'created';
  title?: string;
  fields?: CreatedField[];
  adId?: string;
  name?: string;
  status?: string;
  metaCampaignId?: string;
  /** Pre-minted `launch_ad` confirmation token (single-ask launch). Present
   *  when the draft card itself is the launch proposal, so the operator's
   *  next-turn "launch it" goes straight to `executeLaunchAd` without a
   *  second confirmation card. Absent when minting failed — the flow then
   *  falls back to `confirmLaunchAd`. */
  confirmationToken?: string;
  expiresAt?: string;
  /** Rich-card preview fields — read by `AdPreviewCard`. */
  preview?: {
    variant: 'draft' | 'launched';
    adName: string;
    headline?: string;
    primaryText?: string;
    callToAction?: string;
    campaignName?: string;
    videoTitle?: string;
    videoId?: string;
    graphicId?: string;
    budgetDisplay?: string;
    targetingDisplay?: string;
    destinationUrl?: string;
  };
  error?: string;
}

type CreateDraftAdResult = CreateDraftAdOutput | AssetUnresolvedOutput;

/**
 * `meta_ads_createDraftAd` — create the local draft ad row.
 *
 * Non-destructive at the factory level: the API call creates a *draft*
 * (status `draft` / `pending`), nothing is published until `executeLaunchAd`
 * runs. The actual launch is gated by `confirmLaunchAd` + `executeLaunchAd`.
 *
 * On success the tool returns a `uiState: 'created'` payload so the chat
 * renders a Created card with "Launch ad" / "Edit copy" affordances — see
 * the Claire Creation Redesign W1b / W2 briefs.
 *
 * Org-default fallback: when `adPlacement` is omitted the tool defaults to
 * `facebook`. Other defaults (budget, objective) live on the parent
 * campaign, not on individual ads — they are read via `getOrgDefaults` in
 * the create-ad skill before this tool is called.
 */
export const createDraftAdTool = defineTool<
  {
    metaCampaignId: string;
    videoId?: string;
    graphicId?: string;
    assetId?: string;
    assetRef?: string;
    name: string;
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
    targeting: {
      distanceKm?: number;
      ageMin?: number;
      ageMax?: number;
      genders?: number[];
      countries?: string[];
    };
    serviceIds: string[];
    adPlacement?: 'facebook' | 'instagram';
    metaAdsPageId?: string;
    replaceCampaignDrafts?: boolean;
    /** Display fields for the rich preview card. Not sent to the API. */
    campaignName?: string;
    videoTitle?: string;
  },
  CreateDraftAdResult
>({
  feature: 'meta-ads',
  action: 'createDraftAd',
  description:
    'Create a new Meta ad as a draft. Takes the campaign, a creative (pass ' +
    'exactly ONE of: videoId for an AI/rendered video, graphicId for an ' +
    "AI-generated graphic, or assetId for one of the operator's OWN uploaded " +
    'library images/videos — from listLibraryImages), creative fields, ' +
    'targeting, and services. The ad is created locally and NOT yet published. ' +
    'Call confirmLaunchAd after this to let the user review and approve before ' +
    'launching. If the owner referenced one of their OWN uploads in words but ' +
    "you don't have its id, pass their wording as `assetRef` instead of " +
    'guessing an id — the tool resolves it or asks which one.',
  inputSchema: z
    .object({
      metaCampaignId: safeExternalId.describe(
        'The Meta campaign ID to add the ad to'
      ),
      videoId: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Video ID (an AI-generated / rendered video) to use as the ad ' +
            'creative. Pass exactly one of videoId / graphicId / assetId.'
        ),
      graphicId: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Graphic ID (an AI-generated image creative) to use as the ad — ' +
            'e.g. an offer ad graphic from createContent. Pass exactly one of ' +
            'videoId / graphicId / assetId.'
        ),
      assetId: z
        .string()
        .min(1)
        .optional()
        .describe(
          "A library / uploaded media asset ID from the operator's OWN media " +
            'library (get it from listLibraryImages) — use this to run one of ' +
            "the operator's own uploaded IMAGES (or videos) as the ad creative, " +
            'e.g. "use my Endosphere photo". Pass exactly one of videoId / ' +
            'graphicId / assetId.'
        ),
      assetRef: z
        .string()
        .min(1)
        .optional()
        .describe(
          "The owner's own words for an uploaded asset when you do NOT have " +
            'its id (e.g. "my Endosphere photo", "the before pic I uploaded"). ' +
            'Pass this INSTEAD of guessing an assetId. The tool searches the ' +
            'library by name/filename and either attaches the single match or ' +
            'returns candidates to pick from — it never guesses. Provide this ' +
            'OR one of videoId/graphicId/assetId, not both.'
        ),
      name: z.string().describe('Ad name (internal label, max 255 chars)'),
      headline: z.string().optional().describe('Ad headline (max 80 chars)'),
      primaryText: z
        .string()
        .optional()
        .describe('Ad primary text (max 500 chars)'),
      description: z
        .string()
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
        .describe('Call-to-action button (default: LEARN_MORE)'),
      destinationUrl: z
        .string()
        .optional()
        .describe('Landing page URL for the ad'),
      targeting: z
        .object({
          distanceKm: z
            .number()
            .optional()
            .describe(
              "Radius in km (1-500) from the business's saved address."
            ),
          ageMin: z.number().optional().describe('Minimum age (18-65)'),
          ageMax: z.number().optional().describe('Maximum age (18-65)'),
          genders: z
            .array(z.number())
            .optional()
            .describe('Gender filter: 1=male, 2=female'),
          countries: z
            .array(z.string())
            .optional()
            .describe(
              'ISO country codes. Usually OMIT this — the ad inherits the ' +
                "campaign's location targeting. Only set it to the ORG's OWN " +
                'country, never a hardcoded example country.'
            ),
        })
        .describe(
          "Targeting configuration. The AREA is always the business's saved " +
            'address and cannot be set here — only how far, which ages and ' +
            'which genders. Omit countries unless the user explicitly asks to ' +
            "target the org's own country."
        ),
      serviceIds: z
        .array(z.string().min(1))
        .min(1)
        .describe('Service IDs the ad is promoting'),
      adPlacement: z
        .enum(['facebook', 'instagram'])
        .optional()
        .describe('Ad placement platform (default: facebook)'),
      metaAdsPageId: safeExternalId
        .optional()
        .describe(
          'Meta page ID to publish from (uses default page if omitted)'
        ),
      replaceCampaignDrafts: z
        .boolean()
        .optional()
        .describe(
          'Set true on the FIRST createDraftAd of a (re)build to clear the ' +
            "campaign's existing draft ads before this one is created, so a " +
            'rebuild after a pre-launch edit REPLACES the old drafts instead of ' +
            'stacking (which would launch 6 ads where 3 were intended). Leave ' +
            'unset (false) for the remaining ads in the same build, and for ' +
            'one-off ad creation. Only draft ads are cleared; launched ads are safe.'
        ),
      campaignName: z
        .string()
        .optional()
        .describe(
          'Human-readable campaign name for the preview card (e.g., "Laser Hair Removal — July 2025"). Required for a usable preview — pass it from the campaign chosen in step 4 / created in step 5.'
        ),
      videoTitle: z
        .string()
        .optional()
        .describe(
          'Video title for the preview card. Pass the title of the picked video so the preview shows what creative will run.'
        ),
    })
    .refine(
      (i) => {
        const resolved =
          Number(!!i.videoId) + Number(!!i.graphicId) + Number(!!i.assetId);
        // Exactly one resolved creative, OR zero resolved plus an assetRef the
        // tool will resolve (or ask about) at execute time. Never more than one.
        if (resolved > 1) return false;
        return resolved === 1 || !!i.assetRef;
      },
      {
        message:
          'Provide exactly one creative: a videoId, a graphicId, an assetId, ' +
          'or an assetRef for the tool to resolve',
        path: ['assetId'],
      }
    ),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Creating draft ad' },
  execute: async (input, ctx) => {
    // No-silent-substitution (Phase 7): if the owner referenced their own
    // upload in words (`assetRef`) and no creative id was supplied, resolve it
    // to a real assetId or return the candidates so Claire asks — never guess.
    let resolvedAssetId = input.assetId;
    if (
      !input.videoId &&
      !input.graphicId &&
      !resolvedAssetId &&
      input.assetRef
    ) {
      const resolution = await resolveAssetReference(ctx, {
        assetRef: input.assetRef,
        hasResolvedCreative: false,
        mode: 'attach',
      });
      if (resolution.outcome === 'unresolved') {
        return { data: resolution.data };
      }
      if (resolution.outcome === 'resolved') {
        resolvedAssetId = resolution.assetId;
      }
    }

    // Hydrate org defaults so the LLM doesn't have to plumb every field
    // through. Best-effort: if defaults lookup fails we still create the
    // draft with whatever the model passed in.
    let defaultsLoadFailed = false;
    let defaultServiceIdForAds: string | null = null;
    try {
      const defaults = await getOrgDefaults(db, {
        organizationId: ctx.organizationId,
      });
      if (defaults.success) {
        defaultServiceIdForAds = defaults.data.defaultServiceIdForAds;
      } else {
        defaultsLoadFailed = true;
      }
    } catch {
      defaultsLoadFailed = true;
    }

    // If the model didn't pass a service ID and we have a configured org
    // default, fall back to it. This mirrors the brief's "defaults always
    // fill in" principle without forcing the LLM to remember.
    const serviceIds =
      input.serviceIds.length > 0 || !defaultServiceIdForAds
        ? input.serviceIds
        : [defaultServiceIdForAds];

    // Send to the meta-ads API. Display-only fields are stripped — they're
    // for the preview card, not the create-ad service.
    // No `budgetDisplay` / `targetingDisplay` to strip: the model no longer
    // sends either (register #82). Both are derived server-side below.
    const {
      campaignName,
      videoTitle,
      assetId: _assetId,
      assetRef: _assetRef,
      ...rest
    } = input;

    // Targeting is resolved SERVER-SIDE (register #82): trust the model's
    // coordinates only when they aren't near (0,0); otherwise fall back to the
    // org's geocoded primary location; if neither is usable, send no override
    // (inherit the campaign's targeting) and surface an editable note. The
    // display string + source are derived here, never authored by the model.
    const resolvedTargeting = await resolveAdTargeting(
      ctx.organizationId,
      input.targeting
    );
    const targetingDisplay = resolvedTargeting.targetingDisplay;

    // A library / uploaded asset id rides the `videoId` slot: the meta-ads
    // createAd service auto-detects video vs asset (image OR image-asset) there,
    // and the launch path (resolveMediaAsset → uploadImage → link_data.image_hash)
    // turns an image asset into a proper Meta image creative. The API body has
    // no `assetId`/`assetRef` field, so fold the resolved asset into videoId
    // before sending.
    const effectiveVideoId = rest.videoId ?? resolvedAssetId;
    const apiBody = {
      ...rest,
      videoId: effectiveVideoId,
      targeting: resolvedTargeting.targeting,
    };

    // For a library-asset creative, resolve its URL + type so the preview card
    // can render it directly. The card otherwise polls /videos or /graphics by
    // id, which 404s for an asset id and would spin forever. Best-effort — the
    // ad is created regardless; on failure the preview just shows copy only.
    let assetImageUrl: string | undefined;
    let assetVideoUrl: string | undefined;
    let assetThumbnailUrl: string | undefined;
    if (resolvedAssetId) {
      try {
        const assetRecord = await ctx.apiFetch(`assets/${resolvedAssetId}`, {
          schema: getAssetResponseSchema,
        });
        if (assetRecord.type === 'image') {
          assetImageUrl = assetRecord.blobUrl ?? undefined;
        } else {
          assetVideoUrl = assetRecord.blobUrl ?? undefined;
          assetThumbnailUrl = assetRecord.thumbnailUrl ?? undefined;
        }
      } catch {
        // Non-fatal — see comment above.
      }
    }

    // Best-effort body-truncation for the preview card. The model can write
    // long primary text (Meta caps at 500 chars); the card snippet is more
    // readable when clipped.
    const primaryTextSnippet =
      input.primaryText && input.primaryText.length > 220
        ? `${input.primaryText.slice(0, 220)}…`
        : input.primaryText;

    // Anti-hallucination backstop: refuse to bind a service that isn't in the
    // org's real catalogue. createDraftAd is the money-path chokepoint — it
    // pre-mints a `launch_ad` token below, so a fabricated serviceId here is
    // one confirm away from spend on an ad for a service the business doesn't
    // offer. The persona rule tells Claire not to invent services; this is the
    // server-side guarantee. Runs BEFORE the API call and before any token is
    // minted, so a hallucinated-service ad is never created. Fails open on a
    // catalogue-lookup blip (see the validator) — never blocks a real build.
    const grounding = await ctx.runHardBlocks(
      ['noHallucinatedService'],
      { serviceIds },
      ctx
    );
    if (!grounding.pass) {
      return { data: { error: grounding.message } };
    }

    try {
      const data = await ctx.apiFetch<CreateDraftAdApiResponse>('meta-ads', {
        method: 'POST',
        body: { ...apiBody, serviceIds },
      });

      // Budget display is derived SERVER-SIDE from the parent campaign's actual
      // daily budget — never a model-authored string (register #82).
      // Best-effort: null when the campaign budget can't be read, and the card
      // omits the money line rather than showing a guess.
      const { budgetDisplay } = await resolveCampaignBudgetDisplay(ctx, {
        organizationId: ctx.organizationId,
        metaCampaignId: data.metaCampaignId,
      });

      const ctaLabel = input.callToAction
        ? input.callToAction.replace(/_/g, ' ').toLowerCase()
        : undefined;

      const fields: CreatedField[] = [
        { label: 'Ad name', value: data.name },
        ...(input.headline
          ? [{ label: 'Headline', value: input.headline }]
          : []),
        ...(primaryTextSnippet
          ? [{ label: 'Caption', value: primaryTextSnippet }]
          : []),
        ...(ctaLabel ? [{ label: 'Call to action', value: ctaLabel }] : []),
        {
          label: 'Campaign',
          value: campaignName ?? data.metaCampaignId,
        },
        ...(budgetDisplay
          ? [{ label: 'Daily budget', value: budgetDisplay }]
          : []),
        ...(targetingDisplay
          ? [{ label: 'Targeting', value: targetingDisplay }]
          : []),
        { label: 'Status', value: 'Draft — not running yet' },
      ];

      // Single-ask launch: mint the `launch_ad` confirmation token HERE, on the
      // draft card the operator is about to read, rather than waiting for them
      // to say "launch it" and then asking a second time (`confirmLaunchAd`).
      //
      // The turn-boundary rule (#131) is untouched: the token is created in
      // THIS turn, so it still cannot be consumed until the operator's reply
      // lands in a later turn. What changes is only WHICH message carries the
      // proposal — the draft card already shows the copy, budget and targeting
      // being approved, so it is a strictly better confirmation surface than a
      // second card repeating it.
      //
      // Bound to the same field names `confirmLaunchAd` uses, so the factory's
      // payload binding behaves identically. If the operator edits the copy
      // before launching, the changed field contradicts this payload and the
      // factory rejects the token — Claire then falls back to `confirmLaunchAd`
      // and re-asks, which is the correct behaviour for copy that changed.
      // The launch hard-blocks MUST run before minting. `executeLaunchAd` only
      // runs them on its tokenless first call — a token is treated as proof the
      // checks already passed — so minting without checking here would hand out
      // a token that launches copy the blocks should have stopped.
      const launchPayload = {
        adId: data.id,
        adName: data.name,
        headline: input.headline,
        primaryText: input.primaryText,
        callToAction: input.callToAction,
        campaignName,
        destinationUrl: input.destinationUrl,
        budgetDisplay,
      };

      let launchConfirmation: { id: string; expiresAt: Date } | null = null;
      try {
        const hbResult = await ctx.runHardBlocks(
          LAUNCH_AD_HARD_BLOCKS,
          launchPayload,
          ctx
        );
        if (hbResult.pass) {
          launchConfirmation = await ctx.createConfirmation({
            action: 'launch_ad',
            resourceId: data.id,
            payload: launchPayload,
          });
        }
        // On a hard-block we deliberately mint NOTHING and stay silent here:
        // the draft itself is legitimate, and the operator hears about the
        // problem when they ask to launch and `confirmLaunchAd` re-runs the
        // same blocks with its own `hardBlock` presentation.
      } catch {
        // Non-fatal: without a pre-minted token the operator simply gets the
        // original two-step flow via `confirmLaunchAd`. Never fail the draft.
        launchConfirmation = null;
      }

      return {
        presentation: { type: 'ad_preview' as const },
        data: {
          uiState: 'created',
          title: `Draft ad: ${data.name}`,
          fields,
          adId: data.id,
          name: data.name,
          status: data.status,
          metaCampaignId: data.metaCampaignId,
          ...(launchConfirmation
            ? {
                confirmationToken: launchConfirmation.id,
                expiresAt: launchConfirmation.expiresAt.toISOString(),
              }
            : {}),
          preview: {
            variant: 'draft',
            adName: data.name,
            headline: input.headline,
            primaryText: input.primaryText,
            callToAction: input.callToAction,
            campaignName,
            videoTitle,
            // A library-asset creative renders directly from its resolved URL
            // (below); only a real video/graphic id is polled by the card.
            videoId: input.videoId,
            graphicId: input.graphicId,
            ...(assetImageUrl ? { assetImageUrl } : {}),
            ...(assetVideoUrl ? { assetVideoUrl } : {}),
            ...(assetThumbnailUrl ? { assetThumbnailUrl } : {}),
            budgetDisplay: budgetDisplay ?? undefined,
            targetingDisplay,
            destinationUrl: input.destinationUrl,
          },
        },
      };
    } catch (error) {
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue('Failed to create draft ad', { error });
      }
      return {
        data: {
          error:
            error instanceof Error
              ? error.message
              : 'Failed to create draft ad.',
          ...(defaultsLoadFailed
            ? {
                status: 'org-defaults lookup failed; used model-provided input',
              }
            : {}),
        },
      };
    }
  },
});
