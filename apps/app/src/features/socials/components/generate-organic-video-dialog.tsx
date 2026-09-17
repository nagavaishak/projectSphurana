import { getTemplateById } from '@borradh-workspace/features/videos/templates';
import { useRuntimeConfig } from '@borradh-workspace/runtime-config/client';
import {
  CheckIcon,
  ImageIcon,
  LayoutListIcon,
  ListChecksIcon,
  Loader2Icon,
  MessageSquareQuoteIcon,
  PencilLineIcon,
  PlayIcon,
  SearchIcon,
  SparklesIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { VideoPlayer } from '@/components/kibo-ui/video-player/video-player';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  type Asset,
  useListAssets,
  useListAssetsByService,
} from '@/features/assets';
import { useListServices } from '@/features/organization-services';
import { useCreateVideo } from '@/features/videos/api/create-video';
import {
  type GeneratedOrganicCopy,
  type OrganicVariationId,
  generateOrganicCopyForm,
  useGenerateOrganicCopy,
} from '@/features/videos/api/generate-organic-copy';
import { useGetVideo } from '@/features/videos/api/get-video';
import { useQueueVideoExport } from '@/features/videos/api/queue-video-export';
import type { VideoDraftConfig } from '@/features/videos/api/types';
import { cn } from '@/lib/utils';

type OrganicTemplateId =
  | 'caption-tease'
  | 'ins-outs'
  | 'question-cta'
  | 'improves';

interface OrganicTemplateMeta {
  id: OrganicTemplateId;
  variationId: OrganicVariationId;
  title: string;
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
  recommendedClipCount: number;
  maxClipCount: number;
}

const ORGANIC_TEMPLATES: OrganicTemplateMeta[] = [
  {
    id: 'caption-tease',
    variationId: 'caption-tease-1',
    title: 'Caption tease',
    blurb: 'Serif headline + cursive caption, typed onto screen.',
    icon: PencilLineIcon,
    recommendedClipCount: 3,
    maxClipCount: 3,
  },
  {
    id: 'ins-outs',
    variationId: 'ins-outs-1',
    title: 'INS + OUTS',
    blurb: 'Two-column list of dos and don’ts over darkened footage.',
    icon: LayoutListIcon,
    recommendedClipCount: 2,
    maxClipCount: 3,
  },
  {
    id: 'question-cta',
    variationId: 'question-cta-1',
    title: 'Question + Read caption',
    blurb: 'Hook at the top, "Read caption ⬇" at the bottom.',
    icon: MessageSquareQuoteIcon,
    recommendedClipCount: 2,
    maxClipCount: 3,
  },
  {
    id: 'improves',
    variationId: 'improves-1',
    title: 'Service improves',
    blurb: 'Service name → a benefit per clip → closing CTA.',
    icon: ListChecksIcon,
    recommendedClipCount: 5,
    maxClipCount: 6,
  },
];

const TEMPLATE_BY_ID: Record<OrganicTemplateId, OrganicTemplateMeta> =
  Object.fromEntries(ORGANIC_TEMPLATES.map((t) => [t.id, t])) as Record<
    OrganicTemplateId,
    OrganicTemplateMeta
  >;

/** The two fields that reach `POST videos/generate-organic-copy` — see the form. */
const L = generateOrganicCopyForm.labels;

const CLIP_TAG_LABELS: Record<string, string> = {
  all: 'All media',
  procedure: 'Procedure',
  environment: 'Clinic / Environment',
  before: 'Before',
  after: 'After',
  testimonial: 'Testimonial',
  other: 'Other',
};

export interface GenerateOrganicVideoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * GenerateOrganicVideoDialog — AI-driven organic-video creator.
 *
 * Operator picks a service + a template, the asset grid auto-prioritizes
 * footage already linked to that service (and pre-selects N clips), then
 * Submit fires the backend AI copywriter to produce the on-screen copy
 * and immediately queues a render.
 *
 * There are no manual copy inputs — the AI handles all of that based on
 * org context + the focus service.
 */
export function GenerateOrganicVideoDialog({
  open,
  onOpenChange,
}: GenerateOrganicVideoDialogProps) {
  const [templateId, setTemplateId] =
    useState<OrganicTemplateId>('caption-tease');
  const [serviceId, setServiceId] = useState<string>('');
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [musicTrackId, setMusicTrackId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string>('all');

  const meta = TEMPLATE_BY_ID[templateId];

  // Services list — feeds the dropdown.
  const { services, isLoading: isServicesLoading } = useListServices({
    limit: 100,
  });

  // Auto-select only when there is no meaningful choice. With multiple
  // services, list order is not a safe proxy for the user's intended service.
  useEffect(() => {
    if (!serviceId && services.length === 1) {
      setServiceId(services[0].id);
    }
  }, [services, serviceId]);

  const { assets, isLoading: isAssetsLoading } = useListAssets({
    type: 'video',
    tags: activeTag !== 'all' ? [activeTag] : undefined,
    limit: 60,
  });
  const { assets: serviceAssets } = useListAssetsByService(serviceId);

  // Merge service-linked assets into the tag-filtered list (they may not
  // carry the active tag but they're still relevant). De-dup by id, then
  // sort service-linked first so the auto-selector picks them.
  const filteredAssets = useMemo<Asset[]>(() => {
    let result = assets;
    if (activeTag !== 'all' && serviceAssets.length > 0) {
      const present = new Set(assets.map((a) => a.id));
      const missing = serviceAssets.filter((a) => !present.has(a.id));
      if (missing.length > 0) result = [...assets, ...missing];
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((a) => a.name.toLowerCase().includes(q));
    }
    if (serviceAssets.length > 0) {
      const linked = new Set(serviceAssets.map((a) => a.id));
      result = [...result].sort((a, b) => {
        const al = linked.has(a.id) ? 0 : 1;
        const bl = linked.has(b.id) ? 0 : 1;
        return al - bl;
      });
    }
    return result;
  }, [assets, serviceAssets, searchQuery, activeTag]);

  // Auto-select recommended clip count once assets are loaded for the chosen
  // service. Resets every time service OR template changes — the latter
  // because different templates have different recommendedClipCount.
  const lastAutoKeyRef = useRef<string>('');
  useEffect(() => {
    if (isAssetsLoading) return;
    const key = `${serviceId}::${templateId}`;
    if (lastAutoKeyRef.current === key) return;
    const preferred = serviceAssets.length > 0 ? serviceAssets : filteredAssets;
    if (preferred.length === 0) return;
    const n = Math.min(meta.recommendedClipCount, preferred.length);
    setSelectedAssetIds(preferred.slice(0, n).map((a) => a.id));
    lastAutoKeyRef.current = key;
  }, [
    isAssetsLoading,
    serviceId,
    templateId,
    serviceAssets,
    filteredAssets,
    meta.recommendedClipCount,
  ]);

  const { cdnUrl } = useRuntimeConfig();
  const musicTracks = useMemo(
    () => getTemplateById(templateId)?.musicTracks ?? [],
    [templateId]
  );

  // Default the music track once the template is chosen.
  useEffect(() => {
    if (musicTracks.length === 0) return;
    setMusicTrackId(musicTracks[0].id);
  }, [musicTracks]);

  const { generateCopyAsync } = useGenerateOrganicCopy();
  const { queueExportAsync } = useQueueVideoExport();
  const { createVideoAsync } = useCreateVideo();

  /**
   * Tracks where the submit pipeline is. We drive the loading + preview
   * screens off this instead of the individual mutation hooks so the UI
   * stays in the right state across all the awaits.
   *
   *   idle           — form is visible, user is filling it in
   *   writing-copy   — AI is generating headline / list / etc.
   *   creating-video — video row + queue mutation in flight
   *   preview        — render queued, polling for status, showing player
   */
  type Stage = 'idle' | 'writing-copy' | 'creating-video' | 'preview';
  const [stage, setStage] = useState<Stage>('idle');
  const [previewVideoId, setPreviewVideoId] = useState<string | null>(null);
  const [allowStockFootage, setAllowStockFootage] = useState(true);
  const isBusy = stage === 'writing-copy' || stage === 'creating-video';
  const inPreview = stage === 'preview';

  const submitDisabled = isBusy || selectedAssetIds.length === 0 || !serviceId;

  const reset = () => {
    setTemplateId('caption-tease');
    setServiceId('');
    setSelectedAssetIds([]);
    setMusicTrackId('');
    setSearchQuery('');
    setActiveTag('all');
    setStage('idle');
    setPreviewVideoId(null);
    setAllowStockFootage(true);
    lastAutoKeyRef.current = '';
  };

  const handleOpenChange = (next: boolean) => {
    // Don't let the user close mid-submit — would orphan a half-created video
    // or leave the user wondering whether the render queued.
    if (isBusy && !next) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const startAnother = () => {
    setStage('idle');
    setPreviewVideoId(null);
    setSelectedAssetIds([]);
    lastAutoKeyRef.current = '';
  };

  async function onSubmit() {
    if (submitDisabled) return;

    try {
      setStage('writing-copy');
      const copy = await generateCopyAsync({
        variationId: meta.variationId,
        serviceId: serviceId || undefined,
      });

      const orderedClips = selectedAssetIds.map((assetId, i) => ({
        assetId,
        order: i,
      }));

      const chosenTrack =
        musicTracks.find((t) => t.id === musicTrackId) ?? musicTracks[0];
      const resolvedMusicUrl =
        chosenTrack && cdnUrl ? `${cdnUrl}${chosenTrack.path}` : undefined;

      const draftConfig: VideoDraftConfig = {
        narrationType: 'text_only',
        bRollClips: orderedClips,
        captions: {
          enabled: false,
          position: 'bottom',
          fontFamily: 'Inter',
          fontSize: 36,
          textColor: '#FFFFFF',
          highlightColor: '#FFFFFF',
          backgroundColor: '#000000',
          showBackground: false,
        },
        musicVolume: 0.18,
        musicTrackId: chosenTrack?.id,
        musicUrl: resolvedMusicUrl,
        // Organic templates render without an outro — leave `outro` unset.
        orientation: 'portrait',
        ...configBlockForCopy(copy),
      };

      const title = deriveTitle(copy);
      setStage('creating-video');
      const created = await createVideoAsync({
        title,
        templateId,
        variationId: meta.variationId,
        serviceId: serviceId || undefined,
        draftConfig,
        usageType: 'organic',
      });

      await queueExportAsync({ videoId: created.id, allowStockFootage });
      toast.success('Render queued — preview will appear here when ready');
      setPreviewVideoId(created.id);
      setStage('preview');
    } catch (error) {
      setStage('idle');
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to generate organic video'
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl gap-0 p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <SparklesIcon className="size-4" />
            Generate organic video
          </DialogTitle>
          <DialogDescription>
            {isBusy
              ? 'Hang tight — keep this window open until we’re done.'
              : inPreview
                ? 'Render is in progress. The preview will appear below once it’s ready.'
                : 'Pick a service and a template. We’ll AI-generate the copy and line up your service’s footage automatically.'}
          </DialogDescription>
        </DialogHeader>

        {isBusy && <LoadingProgress stage={stage} />}

        {inPreview && previewVideoId && (
          <PreviewPanel videoId={previewVideoId} />
        )}

        {!isBusy && !inPreview && (
          <ScrollArea className="max-h-[70vh]">
            <div className="space-y-6 px-6 py-5">
              {/* Service + music row */}
              <section className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label
                    htmlFor="organic-service"
                    className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
                  >
                    {L.serviceId}
                  </Label>
                  <Select
                    value={serviceId}
                    onValueChange={(v) => setServiceId(v)}
                    disabled={isServicesLoading || services.length === 0}
                  >
                    <SelectTrigger id="organic-service" className="w-full">
                      <SelectValue
                        placeholder={
                          isServicesLoading
                            ? 'Loading services…'
                            : services.length === 0
                              ? 'No services yet'
                              : 'Pick a service'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {services.map((service) => (
                        <SelectItem key={service.id} value={service.id}>
                          {service.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label
                    htmlFor="organic-music"
                    className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
                  >
                    Music
                  </Label>
                  <Select value={musicTrackId} onValueChange={setMusicTrackId}>
                    <SelectTrigger id="organic-music" className="w-full">
                      <SelectValue placeholder="Pick a track" />
                    </SelectTrigger>
                    <SelectContent>
                      {musicTracks.map((track) => (
                        <SelectItem key={track.id} value={track.id}>
                          {track.name}
                          {track.bpm ? ` · ${track.bpm} BPM` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </section>

              {/* Template picker */}
              <section>
                <Label className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                  {L.variationId}
                </Label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {ORGANIC_TEMPLATES.map((t) => (
                    <TemplateCard
                      key={t.id}
                      template={t}
                      isActive={t.id === templateId}
                      onClick={() => setTemplateId(t.id)}
                    />
                  ))}
                </div>
              </section>

              {/* Footage picker */}
              <section>
                <div className="mb-2 flex items-baseline justify-between">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Footage
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {selectedAssetIds.length} / {meta.maxClipCount} selected
                    &middot; service-linked clips picked first
                  </p>
                </div>
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative flex-1">
                    <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search footage..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Select value={activeTag} onValueChange={setActiveTag}>
                    <SelectTrigger className="sm:w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CLIP_TAG_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <AssetPickerGrid
                  assets={filteredAssets}
                  serviceAssetIds={new Set(serviceAssets.map((a) => a.id))}
                  isLoading={isAssetsLoading}
                  maxSelectable={meta.maxClipCount}
                  selectedIds={selectedAssetIds}
                  onSelectionChange={setSelectedAssetIds}
                />
              </section>

              {/* Stock footage opt-in */}
              <section>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex flex-col">
                    <Label htmlFor="stock-footage-toggle" className="text-sm">
                      Use curated stock footage
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      When no footage is uploaded for this service, fill the
                      video with relevant licensed stock clips.
                    </span>
                  </div>
                  <Switch
                    id="stock-footage-toggle"
                    checked={allowStockFootage}
                    onCheckedChange={setAllowStockFootage}
                  />
                </div>
              </section>
            </div>
          </ScrollArea>
        )}

        {!isBusy && !inPreview && (
          <DialogFooter className="border-t px-6 py-4">
            <Button variant="ghost" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={onSubmit} disabled={submitDisabled}>
              <SparklesIcon className="size-4" />
              Generate
            </Button>
          </DialogFooter>
        )}

        {inPreview && (
          <DialogFooter className="border-t px-6 py-4">
            <Button variant="outline" onClick={startAnother}>
              Generate another
            </Button>
            <Button onClick={() => handleOpenChange(false)}>Done</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function deriveTitle(copy: GeneratedOrganicCopy): string {
  switch (copy.kind) {
    case 'caption-tease':
      return truncate(copy.config.headline) || 'Caption tease';
    case 'fade-benefits':
      return truncate(copy.config.lines[0]) || 'Fade-in benefits';
    case 'aesthetic-line':
      return truncate(copy.config.text) || 'Aesthetic line';
    case 'numbered-list':
      return truncate(copy.config.title) || 'Numbered list';
    case 'ins-outs':
      return truncate(copy.config.title) || 'INS + OUTS';
    case 'highlight-caption':
      return truncate(copy.config.lines[0]) || 'Highlight caption';
    case 'question-cta':
      return truncate(copy.config.question) || 'Question + Read caption';
    case 'curiosity-hook':
      return truncate(copy.config.question) || 'Curiosity hook';
    case 'improves':
      return `${copy.config.serviceName} improves`;
    case 'step-timer':
      return truncate(copy.config.title) || 'Step + Timer';
    case 'time-progress':
      return truncate(copy.config.caption) || 'Time-lapse progress';
    case 'poll':
      return truncate(copy.config.question) || 'Poll';
    case 'myth-fact':
      return truncate(copy.config.pairs[0]?.myth ?? '') || 'Myth → Fact';
    case 'versus':
      return `${copy.config.treatmentA} vs ${copy.config.treatmentB}`;
    case 'price-reveal':
      return truncate(copy.config.hook) || 'Price reveal';
    case 'client-question':
      return truncate(copy.config.question) || 'Client question';
    case 'come-with-me':
      return truncate(copy.config.title) || 'Come with me';
  }
}

function truncate(s: string, max = 80): string {
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

/** Map the AI-generated copy onto the matching draftConfig block. */
function configBlockForCopy(
  copy: GeneratedOrganicCopy
): Partial<VideoDraftConfig> {
  switch (copy.kind) {
    case 'caption-tease':
      return { captionTease: copy.config };
    case 'fade-benefits':
      return { fadeBenefits: copy.config };
    case 'highlight-caption':
      return { fadeBenefits: { lines: copy.config.lines, highlight: true } };
    case 'aesthetic-line':
      return { aestheticLine: copy.config };
    case 'numbered-list':
      return { numberedList: copy.config };
    case 'ins-outs':
      return { insOuts: copy.config };
    case 'question-cta':
      return { questionCta: copy.config };
    case 'curiosity-hook':
      return { questionCta: copy.config };
    case 'improves':
      return { improves: copy.config };
    case 'step-timer':
      return { stepTimer: copy.config };
    case 'time-progress':
      return { timeProgress: copy.config };
    case 'poll':
      return { poll: copy.config };
    case 'myth-fact':
      return { mythFact: copy.config };
    case 'versus':
      return { versus: copy.config };
    case 'price-reveal':
      return { priceReveal: copy.config };
    case 'client-question':
      return { clientQuestion: copy.config };
    case 'come-with-me':
      return { comeWithMe: copy.config };
  }
}

// ─── Sub-components ─────────────────────────────────────────────────────

function TemplateCard({
  template,
  isActive,
  onClick,
}: {
  template: OrganicTemplateMeta;
  isActive: boolean;
  onClick: () => void;
}) {
  const Icon = template.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors',
        isActive
          ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
          : 'hover:border-primary/40 hover:bg-muted/50'
      )}
    >
      <div
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-md',
          isActive
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground'
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium">{template.title}</p>
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {template.blurb}
        </p>
      </div>
    </button>
  );
}

/**
 * Loading screen that replaces the form during submit. Renders the three
 * pipeline stages as a checklist — the active step shows a spinner, finished
 * steps show a check, pending steps stay muted. Avoids the "did I click it?"
 * feeling that a single spinner gives.
 */
const STAGE_STEPS: Array<{
  id: 'writing-copy' | 'creating-video' | 'queuing-render';
  label: string;
}> = [
  { id: 'writing-copy', label: 'Writing the on-screen copy' },
  { id: 'creating-video', label: 'Saving the video draft' },
  { id: 'queuing-render', label: 'Queuing the render' },
];

function LoadingProgress({
  stage,
}: {
  stage: 'writing-copy' | 'creating-video' | 'queuing-render' | 'idle';
}) {
  const activeIdx = STAGE_STEPS.findIndex((s) => s.id === stage);
  return (
    <div className="flex flex-col items-center gap-6 px-6 py-12">
      <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Loader2Icon className="size-7 animate-spin" />
      </div>
      <div className="text-center">
        <p className="text-base font-medium">Generating your video</p>
        <p className="mt-1 text-sm text-muted-foreground">
          This usually takes a few seconds.
        </p>
      </div>
      <ul className="w-full max-w-sm space-y-2.5">
        {STAGE_STEPS.map((step, i) => {
          const isDone = i < activeIdx;
          const isActive = i === activeIdx;
          return (
            <li
              key={step.id}
              className={cn(
                'flex items-center gap-3 text-sm',
                isActive
                  ? 'text-foreground'
                  : isDone
                    ? 'text-muted-foreground'
                    : 'text-muted-foreground/60'
              )}
            >
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full border',
                  isDone
                    ? 'border-primary bg-primary text-primary-foreground'
                    : isActive
                      ? 'border-primary text-primary'
                      : 'border-muted-foreground/30'
                )}
              >
                {isDone ? (
                  <CheckIcon className="size-3" />
                ) : isActive ? (
                  <Loader2Icon className="size-3 animate-spin" />
                ) : null}
              </span>
              <span>{step.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Polls the just-created video every 2s until it's `ready` or `failed`.
 * Renders a fitted player on success, a status block while rendering, and
 * an error block on failure. The dialog keeps polling open until the user
 * dismisses it — the parent owns the open state.
 */
function PreviewPanel({ videoId }: { videoId: string }) {
  // Poll every 2s while the render is in flight; once the worker reports a
  // terminal status the hook is told to stop. There's a 2s lag before the
  // poll truly stops (the value used for `refetchInterval` is the previous
  // render's), which is fine — one extra cheap GET.
  const [done, setDone] = useState(false);
  const { video } = useGetVideo(videoId, {
    refetchInterval: done ? false : 2000,
  });
  const status = video?.status ?? 'queued';
  useEffect(() => {
    if (status === 'ready' || status === 'failed') setDone(true);
  }, [status]);
  const stage = video?.processingStage;
  const blobUrl = video?.blobUrl;
  const thumb = video?.thumbnailUrl ?? undefined;

  if (status === 'failed') {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <SparklesIcon className="size-6" />
        </div>
        <p className="text-base font-medium">Render failed</p>
        <p className="text-sm text-muted-foreground">
          {video?.errorMessage ?? 'Something went wrong during render.'}
        </p>
      </div>
    );
  }

  if (status === 'ready' && blobUrl) {
    return (
      <div className="flex flex-col items-center gap-4 px-6 py-5">
        <div className="w-full max-w-xs">
          <VideoPlayer src={blobUrl} poster={thumb} autoPlay />
        </div>
        <p className="text-xs text-muted-foreground">
          Saved to your videos library. Schedule it from the content calendar.
        </p>
      </div>
    );
  }

  // Still rendering — show progress
  const stageLabel = stage
    ? (PROCESSING_STAGE_LABELS[stage] ?? 'Working on it')
    : 'Queued for render';
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-12">
      <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Loader2Icon className="size-7 animate-spin" />
      </div>
      <div className="text-center">
        <p className="text-base font-medium">{stageLabel}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Renders usually take around a minute. You can leave this window open
          or come back later — your video is saved either way.
        </p>
      </div>
    </div>
  );
}

const PROCESSING_STAGE_LABELS: Record<string, string> = {
  downloading: 'Loading source footage',
  generating_voiceover: 'Generating voiceover',
  analyzing: 'Analyzing content',
  transcribing: 'Transcribing audio',
  building_captions: 'Building captions',
  resolving_assets: 'Resolving assets',
  rendering: 'Rendering frames',
};

function AssetPickerGrid({
  assets,
  serviceAssetIds,
  isLoading,
  maxSelectable,
  selectedIds,
  onSelectionChange,
}: {
  assets: Asset[];
  serviceAssetIds: Set<string>;
  isLoading: boolean;
  maxSelectable: number;
  selectedIds: string[];
  onSelectionChange: (next: string[]) => void;
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-md" />
        ))}
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No matching footage. Adjust the filters above or upload some clips from
        the &ldquo;Uploaded content&rdquo; card.
      </div>
    );
  }

  const toggle = (id: string) => {
    const idx = selectedIds.indexOf(id);
    if (idx >= 0) {
      onSelectionChange(selectedIds.filter((x) => x !== id));
      return;
    }
    if (selectedIds.length >= maxSelectable) {
      toast.message(
        `That's the max for this template — deselect a clip to swap.`
      );
      return;
    }
    onSelectionChange([...selectedIds, id]);
  };

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {assets.map((asset) => {
        const order = selectedIds.indexOf(asset.id);
        const isSelected = order >= 0;
        const isLinked = serviceAssetIds.has(asset.id);
        const thumb =
          asset.thumbnailUrl ?? (asset.type === 'video' ? null : asset.blobUrl);
        return (
          <button
            type="button"
            key={asset.id}
            onClick={() => toggle(asset.id)}
            className={cn(
              'group relative aspect-square overflow-hidden rounded-md border bg-muted text-left transition-all',
              isSelected
                ? 'border-primary ring-2 ring-primary/40'
                : 'border-transparent hover:border-primary/40'
            )}
            title={asset.name}
          >
            {thumb ? (
              <img
                src={thumb}
                alt={asset.name}
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center text-muted-foreground">
                {asset.type === 'video' ? (
                  <PlayIcon className="size-6" />
                ) : (
                  <ImageIcon className="size-6" />
                )}
              </div>
            )}
            {isSelected && (
              <Badge
                variant="default"
                className="absolute left-1 top-1 size-6 justify-center rounded-full p-0 text-[11px]"
              >
                {order + 1}
              </Badge>
            )}
            {isLinked && !isSelected && (
              <Badge
                variant="secondary"
                className="absolute right-1 top-1 h-5 gap-1 px-1.5 text-[10px]"
              >
                <SparklesIcon className="size-2.5" />
                For service
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}
