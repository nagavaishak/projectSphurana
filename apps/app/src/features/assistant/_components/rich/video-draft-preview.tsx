import { Button } from '@/components/ui/button';
import { useListAssets } from '@/features/assets/api/list-assets';
import { useGetVideo } from '@/features/videos/api';
import { usePatchVideoDraftConfig } from '@/features/videos/api/patch-video-draft-config';
import { VideoThumbnail } from '@/routes/_authed/create-video/$templateId/-components/shared/video-thumbnail';
import { videoStatusLabels } from '@borradh-workspace/api-client/types';
import { Eye, Loader2, Pencil, VideoIcon, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ClipPickerDialog } from './clip-picker-dialog';
import {
  getOrderedDraftClipAssetIds,
  isDraftVideoEditable,
} from './video-draft-selection';

export interface CreatedField {
  label: string;
  value: string;
}

type TextFrameStyle = 'default' | 'question' | 'answer' | 'disclaimer' | 'cta';

interface TextFramePreview {
  id: string;
  text: string;
  style?: TextFrameStyle;
}

interface VideoDraftPreviewProps {
  videoId: string;
  title: string;
  fields: CreatedField[];
  serviceId?: string | null;
  initialClipAssetIds: string[];
  minClipCount?: number;
  textFrames?: TextFramePreview[];
}

const STYLE_BADGES: Record<
  TextFrameStyle,
  { label: string; className: string }
> = {
  question: {
    label: 'Hook',
    className:
      'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200',
  },
  answer: {
    label: 'Body',
    className: 'bg-muted text-muted-foreground',
  },
  cta: {
    label: 'CTA',
    className:
      'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200',
  },
  disclaimer: {
    label: 'Disclaimer',
    className:
      'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200',
  },
  default: {
    label: 'Text',
    className: 'bg-muted text-muted-foreground',
  },
};

/**
 * Rich card the chat falls back to when a draft has no content item behind
 * it — see the `video_draft` envelope in `tool-renderer`.
 *
 * Same shape as {@link CreatedCard} for the non-clip fields, plus a thumbnail
 * strip of the auto-picked b-roll clips with X-to-remove and a "Pick clips"
 * button that opens {@link ClipPickerDialog}. Changes PATCH the draft's
 * `draftConfig.bRollClips` without starting a render, so the user can finish
 * reviewing the draft before explicitly approving export.
 *
 * Optimistic UI: the local state updates immediately on toggle/picker-Done,
 * and the PATCH fires in the background. If the PATCH fails we toast and
 * revert.
 */
export function VideoDraftPreviewCard({
  videoId,
  title,
  fields,
  serviceId,
  initialClipAssetIds,
  minClipCount = 1,
  textFrames,
}: VideoDraftPreviewProps) {
  // The video this card is CURRENTLY about. Starts as the one the tool named
  // and moves to the fork when an edit to a rendered video creates one —
  // otherwise the owner picks a clip, a new video renders, and the card sits
  // watching the old one forever, showing the footage they just replaced.
  const [activeVideoId, setActiveVideoId] = useState(videoId);
  const [selectedIds, setSelectedIds] = useState<string[]>(initialClipAssetIds);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Tool output is an immutable snapshot of the moment the draft was created.
  // Read the live video so a later render locks the picker and saved clip
  // changes survive conversation reloads.
  const { video } = useGetVideo(activeVideoId, {
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'ready' || status === 'failed' ? false : 5000;
    },
  });
  const videoStatus = video?.status;
  const isEditable = isDraftVideoEditable(videoStatus);
  const liveDraftConfig = video?.draftConfig;
  const liveSelectedIds = useMemo(
    () =>
      liveDraftConfig ? getOrderedDraftClipAssetIds(liveDraftConfig) : null,
    [liveDraftConfig]
  );

  useEffect(() => {
    if (!liveSelectedIds) return;
    setSelectedIds(liveSelectedIds);
    if (videoStatus !== 'draft') setPickerOpen(false);
  }, [liveSelectedIds, videoStatus]);

  // We need clip metadata (name, thumbnail, duration) to render the strip.
  // Fetching the full org video library is the same call the picker dialog
  // makes, so the query is shared via React Query — no duplicate roundtrip.
  const { assets } = useListAssets({
    type: 'video',
    source: 'raw',
    limit: 100,
  });
  const assetById = useMemo(() => {
    const map = new Map<string, (typeof assets)[number]>();
    for (const a of assets) map.set(a.id, a);
    return map;
  }, [assets]);

  // The write lives in its operation's mutation hook, which owns the payload
  // builder and the cache invalidation (form-contract source rule).
  const { patchDraftConfigAsync: patchClips, isPatching: patching } =
    usePatchVideoDraftConfig();

  const persistSelection = async (next: string[]) => {
    const previous = selectedIds;
    setSelectedIds(next);
    try {
      const result = await patchClips({
        videoId: activeVideoId,
        clipAssetIds: next,
      });
      // Editing a video that already rendered forks rather than overwrites, so
      // follow the fork. `forkedFromVideoId` is only set when that happened.
      const forked = result as { video?: { id?: string } } | undefined;
      const nextId = forked?.video?.id;
      if (nextId && nextId !== activeVideoId) setActiveVideoId(nextId);
    } catch (error) {
      setSelectedIds(previous);
      toast.error(
        error instanceof Error ? error.message : 'Failed to update clips'
      );
    }
  };

  const handleRemove = (assetId: string) => {
    void persistSelection(selectedIds.filter((id) => id !== assetId));
  };

  const handlePickerConfirm = (ids: string[]) => {
    void persistSelection(ids);
  };

  const belowMin = selectedIds.length < minClipCount;

  return (
    <div className="w-full rounded-lg border bg-card p-4 sm:max-w-lg">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Eye className="size-4 text-muted-foreground" />
        {title}
      </div>

      {fields.length > 0 && (
        <dl className="mt-3 space-y-1.5">
          {fields
            // Hide the auto-generated "Clips" summary field — we render the
            // interactive strip below instead, and showing both is noise.
            // Hide the "Script" field too when we have textFrames — the
            // text-frame preview shows the same content with proper styling
            // per frame, so the raw script repeat is duplicative.
            .filter(
              (f) =>
                f.label !== 'Clips' &&
                !(f.label === 'Script' && textFrames && textFrames.length > 0)
            )
            .map((field) => (
              <div
                key={field.label}
                className="flex items-baseline justify-between gap-3 text-xs"
              >
                <dt className="text-muted-foreground shrink-0">
                  {field.label}
                </dt>
                <dd className="truncate font-medium text-right">
                  {field.label === 'Status' && video
                    ? videoStatusLabels[video.status]
                    : field.value}
                </dd>
              </div>
            ))}
        </dl>
      )}

      {textFrames && textFrames.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="text-xs text-muted-foreground">
            On-screen text ({textFrames.length} frame
            {textFrames.length === 1 ? '' : 's'})
          </div>
          <ol className="space-y-1.5">
            {textFrames.map((frame, idx) => {
              const badge = STYLE_BADGES[frame.style ?? 'default'];
              return (
                <li key={frame.id} className="rounded-md border bg-card/50 p-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground/70 tabular-nums">
                      {idx + 1}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-snug break-words">
                    {frame.text}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-xs">
          {/* Not "Uploaded" — the picker offers the curated stock bank too,
              and most orgs fill a video entirely from it. The old label told
              them their own footage was the only option. */}
          <span className="text-muted-foreground">
            B-roll ({selectedIds.length}
            {minClipCount > 0 ? ` / min ${minClipCount}` : ''})
          </span>
          {isEditable && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => setPickerOpen(true)}
              disabled={patching}
            >
              {patching ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Pencil className="size-3" />
              )}
              {selectedIds.length > 0 ? 'Change' : 'Pick clips'}
            </Button>
          )}
        </div>

        {belowMin && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            Pick at least {minClipCount} clip{minClipCount === 1 ? '' : 's'}{' '}
            before rendering.
          </p>
        )}

        {selectedIds.length === 0 && isEditable ? (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed py-6 text-xs text-muted-foreground hover:border-muted-foreground/60"
          >
            <VideoIcon className="size-4" />
            No clips selected — tap to pick
          </button>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {selectedIds.map((assetId) => {
              const asset = assetById.get(assetId);
              return (
                <div
                  key={assetId}
                  className="relative shrink-0 overflow-hidden rounded-md border bg-muted"
                  style={{ width: '88px', aspectRatio: '16 / 9' }}
                >
                  {asset?.thumbnailUrl ? (
                    <img
                      src={asset.thumbnailUrl}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : asset?.blobUrl ? (
                    <VideoThumbnail
                      src={asset.blobUrl}
                      className="size-full"
                      isImage={asset.type === 'image'}
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center">
                      <VideoIcon className="size-4 text-muted-foreground/40" />
                    </div>
                  )}
                  {isEditable && (
                    <button
                      type="button"
                      aria-label="Remove clip"
                      onClick={() => handleRemove(assetId)}
                      disabled={patching}
                      className="absolute right-1 top-1 rounded-full bg-black/70 p-0.5 text-white hover:bg-black/90 disabled:opacity-50"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                  {asset?.name && (
                    <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-1.5 py-0.5 text-[9px] text-white">
                      {asset.name}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isEditable && (
        <ClipPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          selectedIds={selectedIds}
          onConfirm={handlePickerConfirm}
          serviceId={serviceId ?? null}
          minCount={minClipCount}
        />
      )}
    </div>
  );
}
