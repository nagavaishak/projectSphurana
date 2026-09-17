import { MobilePageShell } from '@/components/app/mobile-page-shell';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  MassVideoUploadDialog,
  useDeleteAsset,
  useListAssets,
} from '@/features/assets';
import { useGetSession } from '@/features/auth';
import { useDeleteGraphic, useListGraphics } from '@/features/graphics';
import {
  MobileRecordListEmpty,
  MobileSearchField,
  MobileSegmentedTabs,
} from '@/features/mobile-ui';
import { NewPostDialog } from '@/features/socials';
import { useDeleteVideo, useListVideos } from '@/features/videos';
import {
  Image as ImageIcon,
  Play,
  SendIcon,
  Sparkles,
  Upload,
  Video as VideoIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import type { GalleryMediaItem } from './media-preview-dialog';
import { MediaPreviewDialog } from './media-preview-dialog';
import { PostContentDialog } from './post-content-dialog';
import { type PostableMedia, toPostableMedia } from './postable-media';

/**
 * Phone view of the gallery pages (Gallery / Images / Videos / Library).
 *
 * The desktop masonry becomes a plain two-column grid of square tiles — media
 * reads better as a grid than as a record list. Tapping a tile opens the same
 * `MediaPreviewDialog` the desktop uses, so preview / delete / post all behave
 * identically.
 */

type GalleryMobileMode = 'both' | 'images' | 'videos' | 'library';
type MediaType = 'images' | 'videos';

function tileKey(item: GalleryMediaItem): string {
  return `${item.kind}-${item.data.id}`;
}

function tileThumbnail(item: GalleryMediaItem): string | null {
  if (item.kind === 'asset') {
    return item.data.type === 'video'
      ? item.data.thumbnailUrl
      : item.data.blobUrl;
  }
  if (item.kind === 'video') return item.data.thumbnailUrl;
  return item.data.outputs?.[0]?.url ?? null;
}

function tileAlt(item: GalleryMediaItem): string {
  if (item.kind === 'asset') return item.data.name;
  return item.data.title || 'Untitled';
}

function tileIsVideo(item: GalleryMediaItem): boolean {
  return (
    item.kind === 'video' ||
    (item.kind === 'asset' && item.data.type === 'video')
  );
}

function GalleryMobileGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="aspect-square w-full rounded-xl" />
      ))}
    </div>
  );
}

interface GalleryMobilePageProps {
  heading: string;
  mode?: GalleryMobileMode;
}

export function GalleryMobilePage({
  heading,
  mode = 'both',
}: GalleryMobilePageProps) {
  const [mediaType, setMediaType] = useState<MediaType>(
    mode === 'videos' ? 'videos' : 'images'
  );
  const [search, setSearch] = useState('');
  const [previewItem, setPreviewItem] = useState<GalleryMediaItem | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [postAsset, setPostAsset] = useState<PostableMedia | null>(null);
  const [postOpen, setPostOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);

  const { session } = useGetSession();
  const activeOrgId = session?.activeOrganizationId;

  const {
    assets: imageAssets,
    isLoading: imageAssetsLoading,
    refetch: refetchImageAssets,
  } = useListAssets({ type: 'image' });
  const { graphics, isLoading: graphicsLoading } = useListGraphics();
  const {
    assets: videoAssets,
    isLoading: videoAssetsLoading,
    refetch: refetchVideoAssets,
  } = useListAssets({ type: 'video' });
  const { videos, isLoading: videosLoading } = useListVideos();

  const closePreview = () => setPreviewOpen(false);
  const { deleteAsset, isDeleting: isDeletingAsset } = useDeleteAsset({
    onSuccess: closePreview,
  });
  const { deleteVideo, isDeleting: isDeletingVideo } = useDeleteVideo({
    onSuccess: closePreview,
  });
  const { deleteGraphic, isDeleting: isDeletingGraphic } = useDeleteGraphic({
    onSuccess: closePreview,
  });

  const imageItems = useMemo<GalleryMediaItem[]>(
    () => [
      ...graphics
        .filter((g) => g.outputs?.[0]?.url)
        .map((g) => ({ kind: 'graphic', data: g }) as const),
      ...imageAssets.map((a) => ({ kind: 'asset', data: a }) as const),
    ],
    [graphics, imageAssets]
  );

  const videoItems = useMemo<GalleryMediaItem[]>(
    () => [
      ...videos
        .filter((v) => v.status !== 'draft' && v.status !== 'failed')
        .map((v) => ({ kind: 'video', data: v }) as const),
      ...videoAssets.map((a) => ({ kind: 'asset', data: a }) as const),
    ],
    [videos, videoAssets]
  );

  // The library is the uploaded-content view: assets only, images and videos.
  const libraryItems = useMemo<GalleryMediaItem[]>(
    () => [
      ...imageAssets.map((a) => ({ kind: 'asset', data: a }) as const),
      ...videoAssets.map((a) => ({ kind: 'asset', data: a }) as const),
    ],
    [imageAssets, videoAssets]
  );

  const showTypeTabs = mode === 'both';
  const activeType: MediaType =
    mode === 'images' ? 'images' : mode === 'videos' ? 'videos' : mediaType;

  const items = useMemo(() => {
    const base =
      mode === 'library'
        ? libraryItems
        : activeType === 'images'
          ? imageItems
          : videoItems;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((item) => tileAlt(item).toLowerCase().includes(q));
  }, [mode, activeType, imageItems, videoItems, libraryItems, search]);

  const isLoading =
    mode === 'library'
      ? imageAssetsLoading || videoAssetsLoading
      : activeType === 'images'
        ? imageAssetsLoading || graphicsLoading
        : videoAssetsLoading || videosLoading;

  const handleDelete = (item: GalleryMediaItem) => {
    if (item.kind === 'asset') deleteAsset(item.data.id);
    else if (item.kind === 'video') deleteVideo(item.data.id);
    else deleteGraphic(item.data.id);
  };

  const handlePost = (item: GalleryMediaItem) => {
    const asset = toPostableMedia(item);
    if (!asset) return;
    setPostAsset(asset);
    setPostOpen(true);
  };

  if (!activeOrgId) {
    return (
      <MobilePageShell contentClassName="px-4 pb-4" title={heading}>
        <p className="py-12 text-center text-[15px] text-[#737373]">
          No organization selected. Please select an organization to view
          content.
        </p>
      </MobilePageShell>
    );
  }

  return (
    <MobilePageShell
      contentClassName="flex flex-col gap-3 px-4 pb-4"
      title={heading}
      toolbar={
        <div className="flex items-center gap-2">
          <MobileSearchField
            className="min-w-0 flex-1"
            onChange={setSearch}
            placeholder="Search content…"
            value={search}
          />
          {showTypeTabs ? (
            <MobileSegmentedTabs
              aria-label="Media type"
              onValueChange={(value) => setMediaType(value as MediaType)}
              tabs={[
                { value: 'images', icon: ImageIcon, ariaLabel: 'Show images' },
                { value: 'videos', icon: VideoIcon, ariaLabel: 'Show videos' },
              ]}
              value={mediaType}
            />
          ) : null}
        </div>
      }
    >
      <div className="flex items-center gap-2">
        <MassVideoUploadDialog
          trigger={
            <Button variant="outline" className="flex-1">
              <Upload className="size-4" />
              Upload
            </Button>
          }
          onSuccess={() => {
            refetchImageAssets();
            refetchVideoAssets();
          }}
        />
        {mode !== 'library' ? (
          <Button className="flex-1" onClick={() => setGenerateOpen(true)}>
            <Sparkles className="size-4" />
            Generate
          </Button>
        ) : null}
      </div>

      {isLoading ? <GalleryMobileGridSkeleton /> : null}

      {!isLoading && items.length === 0 ? (
        <MobileRecordListEmpty
          icon={activeType === 'videos' ? VideoIcon : ImageIcon}
          title={search.trim() ? 'No matching content' : 'Nothing here yet'}
          description={
            search.trim()
              ? 'Try a different search term.'
              : 'Upload or generate content to see it here.'
          }
        />
      ) : null}

      {!isLoading && items.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {items.map((item) => {
            const thumbnail = tileThumbnail(item);
            const isVideo = tileIsVideo(item);
            const postable = toPostableMedia(item);
            return (
              <button
                key={tileKey(item)}
                type="button"
                onClick={() => {
                  setPreviewItem(item);
                  setPreviewOpen(true);
                }}
                className="relative aspect-square w-full overflow-hidden rounded-xl border border-[#ECECEC] bg-[#F2F2F7] active:opacity-90"
              >
                {thumbnail ? (
                  <img
                    src={thumbnail}
                    alt={tileAlt(item)}
                    loading="lazy"
                    decoding="async"
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="flex size-full items-center justify-center text-[#8E8E93]">
                    {isVideo ? (
                      <VideoIcon className="size-7" />
                    ) : (
                      <ImageIcon className="size-7" />
                    )}
                  </span>
                )}
                {isVideo ? (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="flex size-9 items-center justify-center rounded-full bg-black/45">
                      <Play className="size-4 text-white" />
                    </span>
                  </span>
                ) : null}
                {postable ? (
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Post ${tileAlt(item)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePost(item);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        handlePost(item);
                      }
                    }}
                    className="absolute right-1.5 top-1.5 flex size-8 items-center justify-center rounded-full bg-black/55 text-white active:bg-black/70"
                  >
                    <SendIcon className="size-4" aria-hidden />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <NewPostDialog open={generateOpen} onOpenChange={setGenerateOpen} />

      <MediaPreviewDialog
        item={previewItem}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        onDelete={handleDelete}
        isDeleting={isDeletingAsset || isDeletingVideo || isDeletingGraphic}
      />

      {postAsset && (
        <PostContentDialog
          open={postOpen}
          onOpenChange={(open) => {
            setPostOpen(open);
            if (!open) setPostAsset(null);
          }}
          asset={postAsset}
          onSuccess={() => setPostOpen(false)}
        />
      )}
    </MobilePageShell>
  );
}
