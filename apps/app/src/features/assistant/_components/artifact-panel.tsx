import { apiClient } from '@borradh-workspace/api-client';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronLeftIcon,
  ChevronRightIcon,
  X,
} from 'lucide-react';
import { useState } from 'react';

import { VideoPlayer } from '@/components/kibo-ui/video-player/video-player';
import { Button } from '@/components/ui/button';
import { queryKeys } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import type { OpenArtifact } from './artifact-panel-context';
import { useArtifactPanel } from './artifact-panel-context';
import { ContentPanelActions } from './content-panel-actions';

interface PanelArtifact {
  id: string;
  title?: string | null;
  status: string;
  progress?: number | null;
  processingStage?: string | null;
  blobUrl?: string | null;
  thumbnailUrl?: string | null;
  errorMessage?: string | null;
  /** Graphics render one image per slide; a single graphic has one. */
  outputs?: Array<{ url: string; thumbnailUrl?: string; slideOrder?: number }>;
}

const POLL_INTERVAL = 5_000;

/** In flight — the states where the worker still owes us pixels. */
function isRendering(status: string): boolean {
  return (
    status === 'queued' || status === 'processing' || status === 'rendering'
  );
}

/**
 * The finished render, beside the conversation rather than inside it.
 *
 * A render takes anywhere from seconds to a couple of minutes, and a chat is
 * the wrong shape to wait in: the card that started it scrolls away as soon as
 * anything else is said, so the owner either stops talking to keep it in view
 * or loses track of it. A panel holds still.
 *
 * It POLLS RATHER THAN BEING TOLD. The render outlives the turn that started
 * it — usually the card too — so the only durable handle is the identity, and
 * everything else is read back from the server. That also means a reload or a
 * second edit lands somewhere sensible: the panel follows whatever it was last
 * given, including the FORK an edit produces.
 *
 * Videos and graphics share it because they are the same thing to the owner —
 * a finished piece of content to look at. Only the endpoint and the player
 * differ, and both of those are one branch.
 */
export function ArtifactPanel({
  artifact,
  onDecided,
  closable = true,
}: {
  artifact: OpenArtifact;
  /** Called after Save / Schedule / Reject, so a queue can advance. */
  onDecided?: () => void;
  /**
   * Whether the panel can be dismissed.
   *
   * False on the review page, where the panel is a permanent column — closing
   * it there would leave a review screen with nothing to review and no way
   * back except picking another post.
   */
  closable?: boolean;
}) {
  const { close } = useArtifactPanel();
  const isVideo = artifact.kind === 'video';

  const { data, isLoading } = useQuery({
    // Same key the cards poll on, so one request feeds both and they can never
    // disagree about whether the render has finished.
    queryKey: queryKeys.content.asset(artifact.kind, artifact.id),
    queryFn: () =>
      apiClient.get<PanelArtifact>(
        `${isVideo ? 'videos' : 'graphics'}/${artifact.id}`
      ),
    refetchInterval: (query) =>
      query.state.data && isRendering(query.state.data.status)
        ? POLL_INTERVAL
        : false,
  });

  const status = data?.status ?? 'queued';
  const rendering = isLoading || isRendering(status);
  const failed = status === 'failed';
  const images = data?.outputs ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/30">
      {/* No title. The artifact row in the chat is already named, and it is
          what opened this — repeating it here labels a panel showing one
          obvious thing. The decision, and the way out. */}
      <div className="flex items-center justify-end gap-2 border-b px-4 py-2">
        {artifact.itemId ? (
          <ContentPanelActions itemId={artifact.itemId} onDecided={onDecided} />
        ) : null}
        {closable ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={close}
            aria-label="Close panel"
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4">
        {failed ? (
          <div className="flex max-w-xs flex-col items-center gap-2 text-center">
            <AlertTriangle className="size-6 text-destructive" />
            <p className="text-sm font-medium">That render failed.</p>
            <p className="text-xs text-muted-foreground">
              {data?.errorMessage ?? 'Ask Claire to try it again.'}
            </p>
          </div>
        ) : rendering ? (
          /* The pulsing wait.
             Deliberately the SHAPE of the thing being made rather than a
             spinner — the panel is already the size it will be, so pulsing
             that rectangle says "this is filling in" where a spinner says only
             "something is happening somewhere". */
          <div className="flex w-full max-w-sm flex-col items-center gap-3">
            <div className="aspect-[9/16] w-full animate-pulse rounded-lg bg-muted" />
            <p className="animate-pulse text-xs text-muted-foreground">
              {data?.processingStage
                ? `${data.processingStage}…`
                : isVideo
                  ? 'Rendering — usually a minute or two.'
                  : 'Rendering — usually a few seconds.'}
            </p>
            {typeof data?.progress === 'number' && data.progress > 0 ? (
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.min(100, data.progress)}%` }}
                />
              </div>
            ) : null}
          </div>
        ) : isVideo && data?.blobUrl ? (
          /* `max-h-full` and not just `max-w-sm`: a portrait video sized only
             by width runs off the bottom of the panel. Bounding both and
             letting the player take its shape from the media is what keeps a
             9:16 render whole without letterboxing it into a 16:9 box. */
          <div className="flex max-h-full w-full max-w-sm items-center justify-center">
            <VideoPlayer
              fitToMedia
              src={data.blobUrl}
              poster={data.thumbnailUrl ?? undefined}
              className="max-h-full w-auto"
            />
          </div>
        ) : !isVideo && images.length > 0 ? (
          /* One image, or a slideable carousel for a deck. A carousel is read
             in order, so it keeps its prev/next, dots and counter rather than
             becoming a vertical stack. */
          <div className="w-full max-w-sm">
            {images.length === 1 ? (
              <img
                src={images[0].url}
                alt=""
                className="w-full rounded-lg border"
              />
            ) : (
              <GraphicCarousel slides={images} />
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Nothing to show for this one yet.
          </p>
        )}
      </div>
    </div>
  );
}

interface GraphicCarouselProps {
  slides: NonNullable<PanelArtifact['outputs']>;
}

/**
 * Carousel for multi-slide graphics. Every slide sits side-by-side in a track
 * that slides via `translateX`, with prev/next, dots and a counter. Every
 * `<img>` mounts up front so each URL is fetched once and swaps are instant.
 *
 * It lives HERE rather than in the chat card because the panel is where the
 * artwork is now shown — but it had to come with it. Stacking the slides
 * vertically instead would have quietly dropped a control the owner uses to
 * read a carousel in the order it was made.
 */
function GraphicCarousel({ slides }: GraphicCarouselProps) {
  const [index, setIndex] = useState(0);
  const count = slides.length;
  // Belt and braces on top of the panel's `key`. The deck is polled, so it can
  // gain or lose a slide underneath a held index; clamping keeps the track from
  // sliding to an empty position rather than trusting the remount alone.
  const current = Math.min(index, Math.max(0, count - 1));

  const goPrev = () => setIndex((i) => (i - 1 + count) % count);
  const goNext = () => setIndex((i) => (i + 1) % count);

  return (
    <div className="space-y-2">
      <div className="relative w-full overflow-hidden rounded-md border">
        <div
          className="flex transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${current * 100}%)` }}
        >
          {slides.map((slide, i) => (
            <img
              key={slide.url}
              src={slide.url}
              alt={`Slide ${i + 1}`}
              className="w-full shrink-0"
              loading="lazy"
              draggable={false}
            />
          ))}
        </div>

        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label="Previous slide"
          onClick={goPrev}
          className="absolute left-2 top-1/2 size-8 -translate-y-1/2 rounded-full bg-background/80 shadow-md backdrop-blur-sm transition-transform hover:scale-105 hover:bg-background"
        >
          <ChevronLeftIcon className="size-4" />
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label="Next slide"
          onClick={goNext}
          className="absolute right-2 top-1/2 size-8 -translate-y-1/2 rounded-full bg-background/80 shadow-md backdrop-blur-sm transition-transform hover:scale-105 hover:bg-background"
        >
          <ChevronRightIcon className="size-4" />
        </Button>
      </div>

      <div className="flex items-center justify-center gap-1.5">
        {slides.map((slide, i) => (
          <button
            key={slide.url}
            type="button"
            aria-label={`Go to slide ${i + 1}`}
            aria-current={i === current ? 'true' : undefined}
            onClick={() => setIndex(i)}
            className={cn(
              'h-1.5 rounded-full transition-all',
              i === current
                ? 'w-5 bg-foreground'
                : 'w-1.5 bg-muted-foreground/40 hover:bg-muted-foreground/70'
            )}
          />
        ))}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Slide {current + 1} of {count}
      </p>
    </div>
  );
}
