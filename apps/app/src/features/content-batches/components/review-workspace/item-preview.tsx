import { AlertTriangle, Loader2, VideoIcon } from 'lucide-react';

import type { Graphic } from '@/features/graphics';
import {
  GraphicSlideCarousel,
  readyGraphicOutputs,
} from '@/features/socials/components/graphic-slide-carousel';

import type {
  ContentBatchGraphic,
  ContentBatchVideo,
  ContentItemWithAsset,
} from '../../types';

function RenderingState() {
  return (
    <div className="flex aspect-[4/5] w-full items-center justify-center bg-muted">
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <p className="text-sm">Rendering…</p>
      </div>
    </div>
  );
}

function RenderFailedState({ label }: { label: string }) {
  return (
    <div className="flex aspect-[4/5] w-full items-center justify-center bg-destructive/5">
      <div className="flex flex-col items-center gap-2 px-6 text-center text-destructive">
        <AlertTriangle className="size-6" />
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-destructive/80">
          Regenerate to try again, or reject it.
        </p>
      </div>
    </div>
  );
}

function GraphicPreview({
  graphic,
  onIndexChange,
}: {
  graphic: ContentBatchGraphic | null;
  onIndexChange?: (index: number) => void;
}) {
  if (graphic?.status === 'failed') {
    return <RenderFailedState label="This graphic failed to render." />;
  }

  // `ContentBatchGraphic` and the carousel's `Graphic` are both
  // `Serialize<BackendGraphic>` — same shape, re-exported from different
  // barrels — so this cast is structural, not a lie.
  const asGraphic = graphic as unknown as Graphic | null;
  const hasReadySlides =
    graphic?.status === 'ready' && readyGraphicOutputs(asGraphic).length > 0;

  if (!hasReadySlides) return <RenderingState />;

  return (
    <GraphicSlideCarousel
      graphic={asGraphic}
      aspectRatio="4 / 5"
      onIndexChange={onIndexChange}
    />
  );
}

function VideoPreview({ video }: { video: ContentBatchVideo | null }) {
  if (video?.status === 'failed') {
    return <RenderFailedState label="This video failed to render." />;
  }

  if (!video || video.status !== 'ready') return <RenderingState />;

  // The whole frame, never cropped: this is a review screen, and judging copy
  // you cannot fully see is the one thing it must not ask of you.
  //
  // Height is what's bounded, and the card around it is `w-fit` (see
  // PostMockup) so it shrinks to whatever width the media lands at. For a 9:16
  // render, full column width and an uncropped frame cannot both hold — full
  // width made the card ~900px tall and pushed the caption off screen — so the
  // frame wins and the card narrows to match.
  if (video.blobUrl) {
    return (
      <div className="flex justify-center bg-black">
        {/* biome-ignore lint/a11y/useMediaCaption: user content preview */}
        <video
          src={video.blobUrl}
          poster={video.thumbnailUrl ?? undefined}
          className="block h-auto max-h-[58vh] w-auto max-w-full"
          controls
          playsInline
        />
      </div>
    );
  }

  if (video.thumbnailUrl) {
    return (
      <div className="flex justify-center bg-black">
        <img
          src={video.thumbnailUrl}
          alt={video.title}
          className="block h-auto max-h-[58vh] w-auto max-w-full"
        />
      </div>
    );
  }

  return (
    <div className="flex aspect-[4/5] w-full items-center justify-center bg-muted text-muted-foreground">
      <VideoIcon className="size-8" />
    </div>
  );
}

/**
 * The rendered asset for one queue item. Deliberately dumb — every state it can
 * be in (rendering, failed, ready) is a picture, never a disabled control, so
 * the middle column always shows the owner something recognisable.
 */
export function ItemPreview({
  item,
  onSlideChange,
}: {
  item: ContentItemWithAsset;
  onSlideChange?: (index: number) => void;
}) {
  return item.kind === 'graphic' ? (
    <GraphicPreview graphic={item.graphic} onIndexChange={onSlideChange} />
  ) : (
    <VideoPreview video={item.video} />
  );
}
