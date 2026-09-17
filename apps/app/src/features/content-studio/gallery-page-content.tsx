import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  MassVideoUploadDialog,
  useDeleteAsset,
  useListAssets,
} from '@/features/assets';
import { useGetSession } from '@/features/auth';
import { useDeleteGraphic, useListGraphics } from '@/features/graphics';
import { NewPostDialog } from '@/features/socials/components/new-post-dialog';
import { useDeleteVideo, useListVideos } from '@/features/videos';
import {
  Building2,
  Image as ImageIcon,
  Sparkles,
  Upload,
  Video as VideoIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import type { GalleryMediaItem } from './media-preview-dialog';
import { MediaPreviewDialog } from './media-preview-dialog';
import { MediaTile } from './media-tile';
import { PostContentDialog } from './post-content-dialog';
import { type PostableMedia, toPostableMedia } from './postable-media';

type MediaType = 'images' | 'videos';
type MediaSource = 'all' | 'uploaded' | 'generated';

// ─── Per-item helpers ───

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

/**
 * Width/height ratio used to reserve the tile's height before the image file
 * loads, preventing the masonry layout from collapsing and "popping" open.
 * Falls back to undefined when dimensions are unknown (MediaTile then uses its
 * own default).
 */
function tileAspectRatio(item: GalleryMediaItem): number | undefined {
  if (item.kind === 'asset') {
    const { width, height } = item.data;
    return width && height ? width / height : undefined;
  }
  if (item.kind === 'graphic') {
    const output = item.data.outputs?.[0];
    return output?.width && output?.height
      ? output.width / output.height
      : undefined;
  }
  // Video: derive from the draft's orientation when available.
  switch (item.data.draftConfig?.orientation) {
    case 'landscape':
      return 16 / 9;
    case 'square':
      return 1;
    case 'portrait':
      return 9 / 16;
    default:
      return undefined;
  }
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

function tileSource(item: GalleryMediaItem): 'uploaded' | 'generated' {
  return item.kind === 'asset' ? 'uploaded' : 'generated';
}

/** First assigned service name for the tile badge (uploaded assets only). */
function tileServiceName(item: GalleryMediaItem): string | null {
  if (item.kind === 'asset') return item.data.services?.[0]?.name ?? null;
  return null;
}

/**
 * Merged gallery: a toggle between Images and Videos, with tiles laid out
 * Pinterest-style (masonry) in their natural aspect ratio. Clicking a tile
 * opens the shared preview dialog.
 */
export function GalleryPageContent() {
  const [mediaType, setMediaType] = useState<MediaType>('images');
  const [source, setSource] = useState<MediaSource>('all');
  const [previewItem, setPreviewItem] = useState<GalleryMediaItem | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [postAsset, setPostAsset] = useState<PostableMedia | null>(null);
  const [postOpen, setPostOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);

  const { session } = useGetSession();
  const activeOrgId = session?.activeOrganizationId;

  // Images: uploaded image assets + AI-generated graphics
  const {
    assets: imageAssets,
    isLoading: imageAssetsLoading,
    refetch: refetchImageAssets,
  } = useListAssets({
    type: 'image',
  });
  const { graphics, isLoading: graphicsLoading } = useListGraphics();

  // Videos: uploaded video assets + AI-generated videos
  const {
    assets: videoAssets,
    isLoading: videoAssetsLoading,
    refetch: refetchVideoAssets,
  } = useListAssets({
    type: 'video',
  });
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

  const items = useMemo(() => {
    const byType = mediaType === 'images' ? imageItems : videoItems;
    if (source === 'all') return byType;
    return byType.filter((item) => tileSource(item) === source);
  }, [mediaType, source, imageItems, videoItems]);
  const isLoading =
    mediaType === 'images'
      ? imageAssetsLoading || graphicsLoading
      : videoAssetsLoading || videosLoading;

  /**
   * The empty copy names WHY the grid is blank. "No images yet" is wrong when
   * the org has fifty images and the source filter is hiding all of them —
   * it reads as data loss.
   */
  const emptyState = useMemo(() => {
    const noun = mediaType === 'images' ? 'images' : 'videos';
    if (source === 'uploaded') {
      return {
        title: `No uploaded ${noun}`,
        description: `Nothing here was uploaded — switch to All to see ${noun} generated with AI.`,
      };
    }
    if (source === 'generated') {
      return {
        title: `No generated ${noun}`,
        description: `You haven't generated any ${noun} yet — switch to All to see what you've uploaded.`,
      };
    }
    return {
      title: `No ${noun} yet`,
      description:
        mediaType === 'images'
          ? 'Upload your own photos or generate branded images to post from here.'
          : 'Upload your own clips or generate a video to post from here.',
    };
  }, [mediaType, source]);

  const handleTileClick = (item: GalleryMediaItem) => {
    setPreviewItem(item);
    setPreviewOpen(true);
  };

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
      <Empty className="flex-none justify-start">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Building2 />
          </EmptyMedia>
          <EmptyTitle>No organisation selected</EmptyTitle>
          <EmptyDescription>
            Choose an organisation to see the images and videos in its gallery.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            value={mediaType}
            onValueChange={(value) => {
              if (value) setMediaType(value as MediaType);
            }}
          >
            <ToggleGroupItem value="images" aria-label="Show images">
              <ImageIcon className="size-4" />
              Images
            </ToggleGroupItem>
            <ToggleGroupItem value="videos" aria-label="Show videos">
              <VideoIcon className="size-4" />
              Videos
            </ToggleGroupItem>
          </ToggleGroup>

          <Select
            value={source}
            onValueChange={(value) => setSource(value as MediaSource)}
          >
            <SelectTrigger className="w-[140px]" aria-label="Filter by source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="uploaded">Uploaded</SelectItem>
              <SelectItem value="generated">Generated</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <MassVideoUploadDialog
            trigger={
              <Button variant="outline">
                <Upload className="size-4" />
                Upload
              </Button>
            }
            onSuccess={() => {
              refetchImageAssets();
              refetchVideoAssets();
            }}
          />
          <Button onClick={() => setGenerateOpen(true)}>
            <Sparkles className="size-4" />
            Generate Content
          </Button>
        </div>
      </div>

      {isLoading ? (
        <MasonrySkeleton />
      ) : items.length === 0 ? (
        /*
          `flex-none justify-start` so the message sits under the toolbar it
          belongs to. `Empty` is `flex-1` and vertically centred by default,
          which on this tall page drops it into the middle of the viewport.
        */
        <Empty className="flex-none justify-start">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {mediaType === 'images' ? <ImageIcon /> : <VideoIcon />}
            </EmptyMedia>
            <EmptyTitle>{emptyState.title}</EmptyTitle>
            <EmptyDescription>{emptyState.description}</EmptyDescription>
          </EmptyHeader>
          {/*
            A filtered-empty gallery gets a way back to everything rather than
            create buttons that cannot change what the filter excludes.
          */}
          <EmptyContent>
            {source === 'all' ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <MassVideoUploadDialog
                  trigger={
                    <Button variant="outline">
                      <Upload className="size-4" />
                      Upload {mediaType}
                    </Button>
                  }
                  onSuccess={() => {
                    refetchImageAssets();
                    refetchVideoAssets();
                  }}
                />
                <Button onClick={() => setGenerateOpen(true)}>
                  <Sparkles className="size-4" />
                  Generate content
                </Button>
              </div>
            ) : (
              <Button onClick={() => setSource('all')} variant="outline">
                Show all {mediaType}
              </Button>
            )}
          </EmptyContent>
        </Empty>
      ) : (
        <div className="columns-2 gap-4 md:columns-3 lg:columns-4 xl:columns-5">
          {items.map((item) => (
            <div key={tileKey(item)} className="mb-4 break-inside-avoid">
              <MediaTile
                thumbnailUrl={tileThumbnail(item)}
                alt={tileAlt(item)}
                aspectRatio={tileAspectRatio(item)}
                isVideo={tileIsVideo(item)}
                source={tileSource(item)}
                serviceName={tileServiceName(item)}
                onClick={() => handleTileClick(item)}
                onPost={
                  toPostableMedia(item) ? () => handlePost(item) : undefined
                }
                onDelete={() => handleDelete(item)}
              />
            </div>
          ))}
        </div>
      )}

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
    </div>
  );
}

const SKELETON_HEIGHTS = [
  'h-48',
  'h-64',
  'h-40',
  'h-56',
  'h-72',
  'h-44',
  'h-60',
  'h-52',
  'h-68',
  'h-48',
];

function MasonrySkeleton() {
  return (
    <div className="columns-2 gap-4 md:columns-3 lg:columns-4 xl:columns-5">
      {SKELETON_HEIGHTS.map((height, i) => (
        <Skeleton
          key={i}
          className={`mb-4 w-full break-inside-avoid rounded-xl ${height}`}
        />
      ))}
    </div>
  );
}
