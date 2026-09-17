import { createFileRoute } from '@tanstack/react-router';
import { AlertTriangle, Loader2, Play } from 'lucide-react';
import { useState } from 'react';

import { PageShell } from '@/components/app/page-shell';
import { VideoPlayer } from '@/components/kibo-ui/video-player/video-player';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  type TemplatePreviewInput,
  useGetVideo,
  useTemplatePreview,
} from '@/features/videos';

export const Route = createFileRoute('/_authed/dashboard/template-preview')({
  component: TemplatePreviewPage,
});

/**
 * Dev-only harness for comparing the legacy video engine (`v1`) against the
 * renderdoc engine (`v2`) per template. Each "Generate" press creates a fresh
 * video row server-side (BullMQ dedups on videoId, so re-pressing must make a
 * new id) and renders it through the chosen engine; the cell then polls
 * `GET /videos/:id` until the render is ready and plays the result.
 *
 * Covers the four ad templates and the seven ported organics. Some templates
 * have known prerequisites the test org may not satisfy (e.g. before-after
 * needs tagged before/after assets, offer needs an offerId) — those surface
 * the server's error in the cell rather than silently rendering blank.
 */

interface PreviewTemplate {
  /** Group template id passed to the preview endpoint. */
  templateId: string;
  title: string;
  usageType: 'ad' | 'organic';
  /** Surfaced as a hint when the template needs setup the org may lack. */
  note?: string;
  /**
   * A previously-rendered V1 video to show as the baseline in the V1 column
   * (instead of rendering fresh). The page fetches it by id via
   * `GET /videos/:id`, which re-presigns the blobUrl, so the saved render
   * stays playable as signatures expire. "Regenerate" still renders a new one.
   */
  referenceV1VideoId?: string;
}

const PREVIEW_TEMPLATES: PreviewTemplate[] = [
  {
    templateId: 'authority',
    title: 'Authority',
    usageType: 'ad',
    referenceV1VideoId: 'bab7b51c-1f29-4969-9347-1bd5635a016b',
  },
  {
    templateId: 'before-after',
    title: 'Before & After',
    usageType: 'ad',
    note: 'Needs tagged before/after assets — will error without them.',
  },
  {
    templateId: 'educational',
    title: 'Educational',
    usageType: 'ad',
    referenceV1VideoId: '65a441ac-5736-4f8b-8fb5-c45449fbeaba',
  },
  {
    templateId: 'offer',
    title: 'Offer',
    usageType: 'ad',
    note: 'Needs an offerId — will error without one.',
  },
  { templateId: 'caption-tease', title: 'Caption Tease', usageType: 'organic' },
  { templateId: 'fade-benefits', title: 'Fade Benefits', usageType: 'organic' },
  {
    templateId: 'aesthetic-line',
    title: 'Aesthetic Line',
    usageType: 'organic',
  },
  { templateId: 'numbered-list', title: 'Numbered List', usageType: 'organic' },
  { templateId: 'ins-outs', title: 'INS + OUTS', usageType: 'organic' },
  { templateId: 'question-cta', title: 'Question + CTA', usageType: 'organic' },
  { templateId: 'improves', title: 'Service Improves', usageType: 'organic' },
];

const TERMINAL_STATUSES = new Set(['ready', 'failed']);

function statusVariant(
  status: string | undefined
): 'default' | 'secondary' | 'destructive' {
  if (status === 'ready') return 'default';
  if (status === 'failed') return 'destructive';
  return 'secondary';
}

/**
 * One engine cell: a Generate button, then a polling status badge + player for
 * the video the press created. Owns its own videoId so v1 and v2 render
 * independently.
 */
function EngineCell({
  templateId,
  version,
  initialVideoId,
}: {
  templateId: string;
  version: 'v1' | 'v2';
  /** Pre-rendered baseline to show before any Generate press. */
  initialVideoId?: string;
}) {
  // Persist the rendered video per template+version so a refresh keeps the
  // last render on screen; it only changes when Generate/Regenerate succeeds.
  const storageKey = `template-preview:${templateId}:${version}`;
  const [videoId, setVideoIdState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return initialVideoId ?? null;
    return window.localStorage.getItem(storageKey) ?? initialVideoId ?? null;
  });
  const setVideoId = (id: string | null) => {
    setVideoIdState(id);
    if (typeof window === 'undefined') return;
    if (id) {
      window.localStorage.setItem(storageKey, id);
    } else {
      window.localStorage.removeItem(storageKey);
    }
  };
  const [startError, setStartError] = useState<string | null>(null);

  const { generatePreview, isGenerating } = useTemplatePreview({
    onSuccess: (result) => {
      setStartError(null);
      setVideoId(result.videoId);
    },
    onError: (error) => {
      // Keep the previous render visible — only surface the new error.
      setStartError(error.message);
    },
  });

  const { video } = useGetVideo(videoId ?? '', {
    enabled: !!videoId,
    refetchInterval: (query) =>
      TERMINAL_STATUSES.has(query.state.data?.status ?? '') ? false : 2500,
  });

  const handleGenerate = () => {
    const input: TemplatePreviewInput = { templateId, version };
    generatePreview(input);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm uppercase tracking-wide text-muted-foreground">
          {version}
        </span>
        {video?.status && (
          <Badge variant={statusVariant(video.status)}>{video.status}</Badge>
        )}
      </div>

      <Button
        size="sm"
        variant={version === 'v2' ? 'default' : 'outline'}
        onClick={handleGenerate}
        disabled={isGenerating}
      >
        {isGenerating ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Play className="size-4" />
        )}
        {videoId ? 'Regenerate' : `Generate ${version}`}
      </Button>

      {startError && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Failed to start</AlertTitle>
          <AlertDescription>{startError}</AlertDescription>
        </Alert>
      )}

      {videoId && video?.status === 'failed' && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Render failed</AlertTitle>
          <AlertDescription>
            {video.errorMessage ?? 'Unknown render error.'}
          </AlertDescription>
        </Alert>
      )}

      {videoId &&
        !TERMINAL_STATUSES.has(video?.status ?? '') &&
        !startError && (
          <div className="flex aspect-[9/16] items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
          </div>
        )}

      {video?.status === 'ready' && video.blobUrl && (
        <VideoPlayer src={video.blobUrl} className="aspect-[9/16] w-full" />
      )}
    </div>
  );
}

function TemplatePreviewPage() {
  return (
    <PageShell maxWidth="max-w-5xl">
      <div>
        <h1 className="font-bold text-2xl">Template Preview: V1 vs V2</h1>
        <p className="text-muted-foreground">
          Render each template through the legacy engine (V1) and the renderdoc
          engine (V2) to compare them with real org footage. Each press creates
          a fresh render.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {PREVIEW_TEMPLATES.map((template) => (
          <Card key={template.templateId}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle>{template.title}</CardTitle>
                <Badge variant="outline">{template.usageType}</Badge>
              </div>
              <CardDescription>
                {template.templateId}
                {template.note ? ` — ${template.note}` : ''}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <EngineCell
                  templateId={template.templateId}
                  version="v1"
                  initialVideoId={template.referenceV1VideoId}
                />
                <EngineCell templateId={template.templateId} version="v2" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
