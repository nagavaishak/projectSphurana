import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { getGraphicQueryOptions } from '@/features/graphics/api/get-graphic/get-graphic.hook';
import { getVideoQueryOptions } from '@/features/videos/api/get-video/get-video.hook';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, MapPin, Play, Wallet } from 'lucide-react';
import { useState } from 'react';

import { VideoPreviewDialog } from './video-preview-dialog';

/**
 * Combined ad-creative card rendered when `createDraftAd` or `executeLaunchAd`
 * returns. The creative (a video or an offer graphic) sits on top as a clean
 * media box; the ad copy — headline, caption, CTA — sits beneath it.
 *
 * The creative may still be rendering when the card mounts (the create-campaign
 * flow kicks off the render and the draft ad in the same turn). The card polls
 * the video / graphic and shows a pulsing skeleton until it's ready, then swaps
 * the whole card in at once — copy is already present, so the only thing it
 * waits on is the media (the "wait for everything" behaviour).
 *
 * Campaign / budget / targeting meta render only when those display fields are
 * passed (the standalone create-ad flow passes them; the campaign flow omits
 * them for a clean media + copy card).
 *
 * Variants:
 *   - 'draft':    the operator can still rewrite / cancel via chat.
 *   - 'launched': the launched confirmation — shows a "Live" pill.
 */
/**
 * Honest launch state read back from Meta after the launch (ADR-005).
 * Mirrors `adLaunchStateValues` in
 * `packages/features/src/meta-ads/services/verify-ad-launch-state/`.
 */
export type AdLaunchCardState =
  | 'live'
  | 'live_but_campaign_paused'
  | 'pending_review'
  | 'paused_at_meta'
  | 'rejected'
  | 'failed'
  | 'unverified'
  // Idempotency no-op (Phase 4 #95): the ad was already launched, so this call
  // created nothing. The pill says "Already live" and the state is a re-read.
  | 'already_live';

export interface AdPreviewProps {
  variant: 'draft' | 'launched';
  /**
   * What produced this card. A LAUNCH puts an ad on Meta for the first time;
   * an EDIT changes copy on an ad that is already there. Both render the
   * 'launched' variant, but the no-read-back fallback has to say different
   * things: "Submitted to Meta" is right after a launch and simply wrong after
   * editing an ad that has been delivering for a week. Defaults to 'launch',
   * so every existing caller keeps its current copy. (ENG-631)
   */
  context?: 'launch' | 'edit';
  /**
   * Verified state for the 'launched' variant. When absent on a launched
   * card, the card renders the conservative "Submitted" pill — it never
   * claims "Live" without a read-back.
   */
  launchState?: AdLaunchCardState;
  adName: string;
  headline?: string;
  primaryText?: string;
  callToAction?: string;
  campaignName?: string;
  videoTitle?: string;
  videoId?: string;
  graphicId?: string;
  /**
   * A library / uploaded IMAGE asset used as ad creative — rendered directly
   * from this URL (no polling; unlike videoId/graphicId there's no async
   * render to wait on).
   */
  assetImageUrl?: string;
  /** A library / uploaded VIDEO asset used as ad creative — rendered directly. */
  assetVideoUrl?: string;
  /** Thumbnail for a library / uploaded VIDEO asset. */
  assetThumbnailUrl?: string;
  budgetDisplay?: string;
  targetingDisplay?: string;
  destinationUrl?: string;
}

function formatCta(cta: string): string {
  return cta
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}

const POLL_INTERVAL = 4_000; // 4s — match the graphic/video status cards.

/**
 * Pill + optional notice per verified launch state. `undefined` state (old
 * payloads / unverified deploys) gets the conservative "Submitted" pill —
 * the card never says "Live" without a read-back.
 */
function launchStateDisplay(
  state: AdLaunchCardState | undefined,
  context: 'launch' | 'edit' = 'launch'
): {
  pill: string;
  pillVariant: 'default' | 'secondary' | 'outline' | 'destructive';
  notice?: string;
} {
  switch (state) {
    case 'live':
      return { pill: 'Live', pillVariant: 'default' };
    case 'already_live':
      return {
        pill: 'Already live',
        pillVariant: 'default',
        notice:
          'This ad was already launched — nothing new was created and no extra budget was spent.',
      };
    case 'live_but_campaign_paused':
      return {
        pill: 'Campaign paused',
        pillVariant: 'secondary',
        notice:
          'The ad is approved, but its campaign is paused — nothing is delivering. Ask Claire to resume the campaign to start delivery.',
      };
    case 'pending_review':
      return {
        pill: 'In Meta review',
        pillVariant: 'secondary',
        notice:
          'Meta is reviewing this ad. It will not deliver until approved.',
      };
    case 'paused_at_meta':
      return {
        pill: 'Paused at Meta',
        pillVariant: 'secondary',
        notice: 'This ad is paused on Meta and is not delivering.',
      };
    case 'rejected':
      return {
        pill: 'Rejected',
        pillVariant: 'destructive',
        notice: 'Meta rejected this ad. It is not running.',
      };
    case 'failed':
      return {
        pill: 'Not running',
        pillVariant: 'destructive',
        notice: 'Meta reports an issue with this ad. It is not running.',
      };
    default:
      // No read-back. Stay conservative — never claim "Live" here — but say
      // which thing was not verified. After an edit the ad was already on
      // Meta, so "Submitted to Meta" would describe a launch that never
      // happened.
      return context === 'edit'
        ? {
            pill: 'Edit submitted',
            pillVariant: 'outline',
            notice:
              'The change is on the live ad. Meta re-reviews an edited ad, so delivery can pause until that clears.',
          }
        : {
            pill: 'Submitted',
            pillVariant: 'outline',
            notice:
              'Submitted to Meta — the live status could not be verified yet.',
          };
  }
}

export function AdPreviewCard({
  variant,
  context,
  launchState,
  adName,
  headline,
  primaryText,
  callToAction,
  campaignName,
  videoTitle,
  videoId,
  graphicId,
  assetImageUrl,
  assetVideoUrl,
  assetThumbnailUrl,
  budgetDisplay,
  targetingDisplay,
  destinationUrl,
}: AdPreviewProps) {
  const [previewOpen, setPreviewOpen] = useState(false);

  // Poll the creative until it's rendered. Only one of videoId / graphicId is
  // set per ad. `refetchInterval` stops once the row reaches a terminal state.
  const videoQuery = useQuery({
    ...getVideoQueryOptions(videoId ?? ''),
    enabled: !!videoId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'ready' || status === 'failed' ? false : POLL_INTERVAL;
    },
  });
  const graphicQuery = useQuery({
    ...getGraphicQueryOptions(graphicId ?? ''),
    enabled: !!graphicId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'ready' || status === 'failed' ? false : POLL_INTERVAL;
    },
  });

  const video = videoQuery.data;
  const graphic = graphicQuery.data;

  // A library / uploaded asset renders directly from its resolved URL — no
  // polling and no skeleton (there's no async render to wait on). It flows
  // through the same computed vars below so the markup stays single-path.
  const hasDirectAsset = !!(assetImageUrl || assetVideoUrl);

  const isVideo = !!videoId || !!assetVideoUrl;
  const thumbnailUrl = video?.thumbnailUrl ?? assetThumbnailUrl ?? undefined;
  const blobUrl = video?.blobUrl ?? assetVideoUrl ?? undefined;
  const imageUrl =
    assetImageUrl ?? graphic?.outputs?.find((o) => o.status !== 'failed')?.url;

  const isLaunched = variant === 'launched';
  const stateDisplay = launchStateDisplay(launchState, context);
  const hasMeta = !!(
    campaignName ||
    budgetDisplay ||
    targetingDisplay ||
    destinationUrl
  );

  const mediaReady = hasDirectAsset
    ? true
    : isVideo
      ? video?.status === 'ready' && !!blobUrl
      : !!imageUrl && graphic?.status === 'ready';
  const mediaFailed = hasDirectAsset
    ? false
    : isVideo
      ? video?.status === 'failed'
      : graphic?.status === 'failed';

  // The creative render failed — surface it instead of an endless skeleton.
  if (mediaFailed) {
    return (
      <div className="w-full rounded-lg border border-destructive/30 bg-card p-4 text-xs text-muted-foreground sm:max-w-md">
        The {isVideo ? 'video' : 'graphic'} for this ad couldn&apos;t be
        rendered. Try again, or tweak the request.
      </div>
    );
  }

  // Wait for the media — show a card-shaped skeleton (a square for the
  // creative, lines for the caption) until the creative is rendered, then drop
  // the finished card in all at once.
  if ((videoId || graphicId) && !mediaReady) {
    return (
      <div className="w-full overflow-hidden rounded-lg border bg-card sm:max-w-md">
        <Skeleton className="aspect-square w-full rounded-none" />
        <div className="space-y-2 p-3">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="mt-1 h-5 w-20 rounded-full" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="w-full overflow-hidden rounded-lg border bg-card sm:max-w-md">
        {/* Creative */}
        {isVideo ? (
          <button
            type="button"
            onClick={() => blobUrl && setPreviewOpen(true)}
            disabled={!blobUrl}
            aria-label={videoTitle ?? adName}
            className="relative block aspect-square w-full overflow-hidden bg-muted disabled:cursor-default"
          >
            {thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbnailUrl}
                alt={videoTitle ?? adName}
                className="size-full object-cover"
              />
            ) : (
              <Play className="absolute inset-0 m-auto size-8 text-muted-foreground/50" />
            )}
            {blobUrl && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors hover:bg-black/30">
                <Play className="size-10 fill-white text-white drop-shadow" />
              </div>
            )}
          </button>
        ) : (
          imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={adName}
              className="w-full"
              loading="lazy"
            />
          )
        )}

        {/* Copy */}
        <div className="space-y-1.5 p-3">
          {isLaunched && (
            <>
              <Badge
                variant={stateDisplay.pillVariant}
                className="gap-1 text-[10px]"
              >
                {launchState === 'live' && <CheckCircle2 className="size-3" />}
                {stateDisplay.pill}
              </Badge>
              {stateDisplay.notice && (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {stateDisplay.notice}
                </p>
              )}
            </>
          )}
          {headline && (
            <p className="text-sm font-semibold leading-snug">{headline}</p>
          )}
          {primaryText && (
            <p className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
              {primaryText}
            </p>
          )}
          {callToAction && (
            <div className="pt-0.5">
              <Badge variant="outline" className="text-[10px]">
                {formatCta(callToAction)}
              </Badge>
            </div>
          )}

          {/* Campaign / budget / targeting — only when provided (standalone
              create-ad flow). The campaign flow omits these for a clean card. */}
          {hasMeta && (
            <div className="mt-2 space-y-1 border-t pt-2">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs font-medium">
                  {adName}
                </span>
                <Badge
                  variant={isLaunched ? stateDisplay.pillVariant : 'secondary'}
                  className="shrink-0 text-[10px]"
                >
                  {isLaunched ? stateDisplay.pill : 'Draft'}
                </Badge>
              </div>
              {campaignName && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="text-[10px]">
                    {campaignName}
                  </Badge>
                </div>
              )}
              {budgetDisplay && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Wallet className="size-3.5 shrink-0" />
                  <span>{budgetDisplay}</span>
                </div>
              )}
              {targetingDisplay && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="size-3.5 shrink-0" />
                  <span>{targetingDisplay}</span>
                </div>
              )}
              {destinationUrl && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ExternalLink className="size-3.5 shrink-0" />
                  <span className="truncate">{destinationUrl}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {isVideo && blobUrl && (
        <VideoPreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          videoUrl={blobUrl}
          thumbnailUrl={thumbnailUrl}
          title={videoTitle ?? adName}
        />
      )}
    </>
  );
}
