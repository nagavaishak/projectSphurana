import { useResolvedRoutes } from '@/lib/use-routes';
import { apiClient } from '@borradh-workspace/api-client';
import { Link } from '@tanstack/react-router';
import { ImageIcon, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { useArtifactPanel } from '../artifact-panel-context';
import { ArtifactRow } from '../artifact-row';
import { PendingReRoll } from './pending-reroll';

/** Subset of the `graphic` row the card needs — mirrors GET /graphics/:id. */
interface GraphicStatusResult {
  graphicId: string;
  status: string;
  title?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  outputs?: Array<{
    url: string;
    thumbnailUrl?: string;
    slideOrder?: number;
    status?: 'success' | 'failed';
  }>;
}

interface GraphicStatusCardProps {
  /** Initial tool output from `createContent`. */
  data: { graphicId: string; status?: string; title?: string };
  /**
   * The content item this graphic belongs to. Carried into the panel so its
   * Save / Schedule / Reject have something to decide ON — those act on the
   * item, not the file.
   */
  itemId?: string;
}

const POLL_INTERVAL = 4_000; // 4 seconds — graphics render fast

/**
 * Statuses the card explicitly recognises as in-progress. Anything else that
 * isn't `ready`/`failed` (a future enum value, a malformed payload) is treated
 * as in-progress too — it keeps polling and shows a fallback link instead of
 * a permanent skeleton (audit finding #172).
 */
const KNOWN_IN_PROGRESS = new Set(['rendering', 'draft']);

/**
 * Self-polling result card for `createGraphic`. Shows a skeleton while the
 * worker renders, then swaps to the rendered image(s) once the row flips to
 * `ready`. Mirrors `ProcessingStatus` (videos) but for graphics — graphics
 * have no progress field, so there's no progress bar.
 */
export function GraphicStatusCard({
  data: initial,
  itemId,
}: GraphicStatusCardProps) {
  const routes = useResolvedRoutes();
  const { openArtifact } = useArtifactPanel();
  const [data, setData] = useState<GraphicStatusResult>({
    graphicId: initial.graphicId,
    status: initial.status ?? 'rendering',
    title: initial.title,
  });

  // Poll for anything that isn't a terminal status — including unknown values
  // (new enum members, malformed payloads). Previously only rendering/draft
  // polled, so an unknown status froze the card on a permanent spinner.
  const isProcessing = data.status !== 'ready' && data.status !== 'failed';

  useEffect(() => {
    if (!isProcessing) return;

    const interval = setInterval(async () => {
      try {
        const graphic = await apiClient.get<
          GraphicStatusResult & { id: string }
        >(`graphics/${data.graphicId}`);
        setData({
          graphicId: graphic.id,
          status: graphic.status,
          title: graphic.title,
          outputs: graphic.outputs,
          errorCode: graphic.errorCode,
          errorMessage: graphic.errorMessage,
        });
      } catch {
        // Silently ignore poll errors — retry next tick.
      }
    }, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [isProcessing, data.graphicId]);

  const slides = (data.outputs ?? [])
    .filter((o) => o.status !== 'failed')
    .slice()
    .sort((a, b) => (a.slideOrder ?? 0) - (b.slideOrder ?? 0));

  // Open the panel when the render LANDS, once.
  //
  // Same rule as a video: the chat gets a ROW, the panel gets the artwork. A
  // graphic embedded in the transcript is the tallest thing on the page and
  // scrolls away with the turn that made it, and every earlier one stays
  // mounted above the current one.
  //
  // Once, via the ref — reopening a panel the owner deliberately closed is the
  // kind of helpfulness that has to be fought.
  const openedRef = useRef(false);
  useEffect(() => {
    if (data.status === 'ready' && slides.length > 0 && !openedRef.current) {
      openedRef.current = true;
      openArtifact({ kind: 'graphic', id: data.graphicId, itemId });
    }
  }, [data.status, data.graphicId, slides.length, openArtifact, itemId]);

  if (data.status === 'ready') {
    if (slides.length === 0) {
      return (
        <div className="w-full rounded-lg border bg-card p-4 text-xs text-muted-foreground sm:max-w-sm">
          Graphic ready — open it in your content library to view.
        </div>
      );
    }

    return (
      <div className="w-full sm:max-w-sm">
        <ArtifactRow
          className="w-full"
          artifact={{ kind: 'graphic', id: data.graphicId, itemId }}
          title={data.title ?? 'Graphic'}
          subtitle={
            slides.length > 1
              ? `Carousel · ${slides.length} slides`
              : 'Graphic · PNG'
          }
          thumbnailUrl={slides[0].thumbnailUrl ?? slides[0].url}
        />
        {/* The decision, attached to the post — the graphic's half of what
            Accept does on the clip list editor. Renders nothing unless a
            re-roll is actually waiting. */}
        {itemId ? (
          <PendingReRoll
            itemId={itemId}
            graphicId={data.graphicId}
            // A re-roll renders into a NEW row, so the card follows it. Left
            // pointing at the id it was born with, the request succeeded and
            // the owner watched the old graphic sit there unchanged.
            onReRolled={(id) =>
              setData({ graphicId: id, status: 'rendering', title: data.title })
            }
          />
        ) : null}
      </div>
    );
  }

  if (data.status === 'failed') {
    return (
      <div className="w-full rounded-lg border border-destructive/30 bg-card p-4 sm:max-w-sm">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <ImageIcon className="size-4" />
          Graphic generation failed
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {data.errorMessage ??
            `${data.title ?? 'The graphic'} could not be rendered. Try again, or tweak the request.`}
        </p>
        {data.errorCode && (
          <p className="mt-2 text-xs font-medium">
            Error code:{' '}
            <span className="select-all font-mono">{data.errorCode}</span>
          </p>
        )}
      </div>
    );
  }

  // Unknown status — still polling above, but surface a visible in-progress
  // card with an escape hatch instead of an indefinite skeleton (#172).
  if (!KNOWN_IN_PROGRESS.has(data.status)) {
    return (
      <div className="w-full rounded-lg border bg-card p-4 sm:max-w-sm">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Loader2 className="size-4 animate-spin" />
          Working on {data.title ?? 'your graphic'}…
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Taking longer than expected?{' '}
          <Link
            to={routes.contentGallery}
            className="font-medium underline underline-offset-2"
          >
            Open it in Content
          </Link>
        </p>
      </div>
    );
  }

  // Rendering / queued — a single pulsing skeleton square that swaps to the
  // rendered image the instant the worker finishes. No spinner / caption (per
  // user directive 2026-06-04): just the radiating placeholder.
  return <Skeleton className="aspect-square w-full rounded-lg sm:max-w-sm" />;
}
