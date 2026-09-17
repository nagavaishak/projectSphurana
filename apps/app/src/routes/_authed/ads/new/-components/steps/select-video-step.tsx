import { Button } from '@/components/ui/button';
import { FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCreateAsset, useListAssets } from '@/features/assets';
import { useListGraphics } from '@/features/graphics';
import type { Graphic } from '@/features/graphics/api/types';
import { useUploadFile } from '@/features/upload';
import { useGetVideo, useListVideos } from '@/features/videos';
import { cn } from '@/lib/utils';
import {
  Check,
  Film,
  Image as ImageIcon,
  Loader2,
  Paintbrush,
  Plus,
  Search,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { toast } from 'sonner';
import { useAdWizard } from '../../-context';
import { useNewAdSearch } from '../../-hooks/use-new-ad-search';
import type { AdWizardFormData } from '../../-schema';

const ACCEPTED_VIDEO_TYPES = '.mp4,.mov,.webm';

/**
 * Get the best thumbnail URL for a graphic.
 * Prefers rendered output URL, falls back to first slide thumbnail.
 */
function getGraphicThumbnail(graphic: Graphic): string | null {
  // Use the first rendered output if available (no per-slide thumbnails today)
  if (graphic.outputs?.length) {
    const firstOutput = graphic.outputs[0];
    // JSONB can return string or object depending on serialization
    if (typeof firstOutput === 'string') return firstOutput;
    return firstOutput.url;
  }
  return null;
}

type MediaType = 'video' | 'image';
type MediaSource = 'generated' | 'uploaded';

const GRID_CLASS = 'grid grid-cols-2 gap-4 max-h-[360px] overflow-y-auto p-1';
const CARD_CLASS =
  'relative rounded-lg border-2 overflow-hidden transition-all text-left';

export function SelectVideoStep() {
  const { videoId: preselectedVideoId } = useNewAdSearch();
  const { setValue, watch, control } = useFormContext<AdWizardFormData>();
  const selectedVideoId = watch('videoId');
  const [searchQuery, setSearchQuery] = useState('');
  const [mediaType, setMediaType] = useState<MediaType>('video');
  const [source, setSource] = useState<MediaSource>('generated');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { setSelectedVideo } = useAdWizard();
  const {
    videos,
    isLoading: isLoadingVideos,
    isError: isVideosError,
    refetch: refetchVideos,
  } = useListVideos();
  const { video: fetchedPreselectedVideo } = useGetVideo(
    preselectedVideoId ?? '',
    {
      enabled: Boolean(preselectedVideoId),
    }
  );
  const {
    assets: videoAssets,
    isLoading: isLoadingVideoAssets,
    isError: isVideoAssetsError,
    refetch: refetchVideoAssets,
  } = useListAssets({
    type: 'video',
  });
  const {
    assets: imageAssets,
    isLoading: isLoadingImageAssets,
    isError: isImageAssetsError,
    refetch: refetchImageAssets,
  } = useListAssets({
    type: 'image',
  });
  const {
    graphics,
    isLoading: isLoadingGraphics,
    isError: isGraphicsError,
    refetch: refetchGraphics,
  } = useListGraphics({
    status: 'ready',
  });

  const { uploadAsync, isUploading } = useUploadFile({
    purpose: 'org-asset',
    showToast: false,
  });
  const { createAssetAsync, isCreating } = useCreateAsset({ showToast: false });
  const isUploadingVideo = isUploading || isCreating;

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Reset input so the same file can be re-selected
      e.target.value = '';

      try {
        const uploadResult = await uploadAsync(file);
        await createAssetAsync({
          file,
          blobUrl: uploadResult.url,
          type: 'video',
        });
        toast.success('Video uploaded');
      } catch {
        toast.error('Failed to upload video');
      }
    },
    [uploadAsync, createAssetAsync]
  );

  // Filter created videos - only show ready videos
  const availableVideos = videos.filter(
    (video) =>
      video.status === 'ready' &&
      video.title?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Filter uploaded video assets
  const availableVideoAssets = videoAssets.filter((asset) =>
    asset.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Filter uploaded image assets
  const availableImageAssets = imageAssets.filter((asset) =>
    asset.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Filter ready graphics
  const availableGraphics = graphics.filter((g) =>
    (g.title || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectVideo = (video: (typeof videos)[0]) => {
    setValue('videoId', video.id, { shouldValidate: true });
    setSelectedVideo(video);
  };

  useEffect(() => {
    if (!preselectedVideoId) return;
    const video =
      videos.find((v) => v.id === preselectedVideoId && v.status === 'ready') ??
      (fetchedPreselectedVideo?.status === 'ready'
        ? fetchedPreselectedVideo
        : undefined);
    if (!video) return;
    setMediaType('video');
    setSource('generated');
    setValue('videoId', video.id, { shouldValidate: true });
    setSelectedVideo(video);
  }, [
    preselectedVideoId,
    videos,
    fetchedPreselectedVideo,
    setValue,
    setSelectedVideo,
  ]);

  const handleSelectAsset = (asset: (typeof videoAssets)[0]) => {
    // For assets, we use the asset ID and convert it to a media object
    setValue('videoId', asset.id, { shouldValidate: true });
    setSelectedVideo({
      id: asset.id,
      title: asset.name,
      thumbnailUrl: asset.thumbnailUrl ?? asset.blobUrl,
      blobUrl: asset.blobUrl,
      durationMs: asset.duration ? String(Number(asset.duration) * 1000) : null,
    });
  };

  const handleSelectImage = (asset: (typeof imageAssets)[0]) => {
    setValue('videoId', asset.id, { shouldValidate: true });
    setSelectedVideo({
      id: asset.id,
      title: asset.name,
      thumbnailUrl: asset.blobUrl,
      blobUrl: asset.blobUrl,
    });
  };

  const handleSelectGraphic = (graphic: Graphic) => {
    const thumbnailUrl = getGraphicThumbnail(graphic);
    setValue('videoId', graphic.id, { shouldValidate: true });
    setSelectedVideo({
      id: graphic.id,
      title: graphic.title,
      thumbnailUrl,
      blobUrl: thumbnailUrl,
    });
  };

  const renderEmpty = (message: string, icon?: React.ReactNode) => (
    <div className="rounded-lg border border-dashed p-8 text-center">
      {icon}
      <p className="text-muted-foreground">{message}</p>
    </div>
  );

  // A failed list load is not an empty library. Without this, every panel here
  // told the user to go create media they may already have.
  const renderError = (what: string, retry: () => void) => (
    <div
      className="rounded-lg border border-dashed p-8 text-center"
      data-claire-target="ads-new-media-error"
    >
      <p className="text-destructive">Couldn't load your {what}.</p>
      <Button
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() => retry()}
      >
        Try again
      </Button>
    </div>
  );

  const renderLoading = () => (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );

  // --- Video · Generated (created videos) ---------------------------------
  const videoGeneratedPanel = isLoadingVideos ? (
    renderLoading()
  ) : isVideosError ? (
    renderError('videos', refetchVideos)
  ) : availableVideos.length === 0 ? (
    renderEmpty(
      searchQuery
        ? 'No videos match your search'
        : 'No videos available. Create a video first.'
    )
  ) : (
    <div className={GRID_CLASS}>
      {availableVideos.map((video) => (
        <button
          key={video.id}
          type="button"
          data-testid="video-card"
          data-video-id={video.id}
          onClick={() => handleSelectVideo(video)}
          className={cn(
            CARD_CLASS,
            selectedVideoId === video.id
              ? 'border-primary ring-2 ring-primary/20'
              : 'border-transparent hover:border-muted-foreground/30'
          )}
        >
          <div className="aspect-video bg-muted relative">
            {video.thumbnailUrl ? (
              <img
                src={video.thumbnailUrl}
                alt={video.title || 'Video thumbnail'}
                className="w-full h-full object-cover"
              />
            ) : video.blobUrl ? (
              <video
                src={video.blobUrl}
                className="w-full h-full object-cover"
                muted
                playsInline
                preload="metadata"
                onLoadedData={(e) => {
                  e.currentTarget.currentTime = 0.001;
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                No preview
              </div>
            )}
            {selectedVideoId === video.id && (
              <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                <Check className="h-4 w-4" />
              </div>
            )}
          </div>
          <div className="p-2">
            <p className="text-sm font-medium truncate">
              {video.title || 'Untitled'}
            </p>
            <p className="text-xs text-muted-foreground">
              {video.durationMs
                ? `${Math.round(Number(video.durationMs) / 1000)}s`
                : 'Duration unknown'}
            </p>
          </div>
        </button>
      ))}
    </div>
  );

  // --- Video · Uploaded (uploaded video assets) ---------------------------
  const videoUploadedPanel = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_VIDEO_TYPES}
        onChange={handleFileChange}
        className="hidden"
      />
      {isLoadingVideoAssets ? (
        renderLoading()
      ) : isVideoAssetsError ? (
        renderError('uploaded videos', refetchVideoAssets)
      ) : availableVideoAssets.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">
            {searchQuery
              ? 'No assets match your search'
              : 'No uploaded videos yet'}
          </p>
          {!searchQuery && (
            <button
              type="button"
              disabled={isUploadingVideo}
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {isUploadingVideo ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {isUploadingVideo ? 'Uploading...' : 'Upload a Video'}
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className={GRID_CLASS}>
            {availableVideoAssets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                data-testid="uploaded-video-card"
                onClick={() => handleSelectAsset(asset)}
                className={cn(
                  CARD_CLASS,
                  selectedVideoId === asset.id
                    ? 'border-primary ring-2 ring-primary/20'
                    : 'border-transparent hover:border-muted-foreground/30'
                )}
              >
                <div className="aspect-video bg-muted relative">
                  {asset.thumbnailUrl ? (
                    <img
                      src={asset.thumbnailUrl}
                      alt={asset.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    // No poster yet: paint a real first frame. `#t=0.1` makes
                    // browsers seek+paint without JS; the metadata seek covers
                    // the rest. Without it the <video> stays a blank grey tile.
                    <video
                      src={`${asset.blobUrl}#t=0.1`}
                      className="w-full h-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                      onLoadedMetadata={(e) => {
                        try {
                          e.currentTarget.currentTime = 0.1;
                        } catch {
                          // Some browsers reject an early seek; #t=0.1 covers them.
                        }
                      }}
                    />
                  )}
                  {selectedVideoId === asset.id && (
                    <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                      <Check className="h-4 w-4" />
                    </div>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-sm font-medium truncate">{asset.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {asset.duration
                      ? `${Math.round(Number(asset.duration))}s`
                      : 'Duration unknown'}
                  </p>
                </div>
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={isUploadingVideo}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-muted-foreground/50 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
          >
            {isUploadingVideo ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {isUploadingVideo ? 'Uploading...' : 'Upload more videos'}
          </button>
        </div>
      )}
    </>
  );

  // --- Image · Generated (graphics) ---------------------------------------
  const imageGeneratedPanel = isLoadingGraphics ? (
    renderLoading()
  ) : isGraphicsError ? (
    renderError('graphics', refetchGraphics)
  ) : availableGraphics.length === 0 ? (
    renderEmpty(
      searchQuery
        ? 'No graphics match your search'
        : 'No rendered graphics yet. Create graphics from the Graphics section.',
      <Paintbrush className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
    )
  ) : (
    <div className={GRID_CLASS}>
      {availableGraphics.map((graphic) => {
        const thumbnailUrl = getGraphicThumbnail(graphic);
        return (
          <button
            key={graphic.id}
            type="button"
            data-testid="graphic-card"
            onClick={() => handleSelectGraphic(graphic)}
            className={cn(
              CARD_CLASS,
              selectedVideoId === graphic.id
                ? 'border-primary ring-2 ring-primary/20'
                : 'border-transparent hover:border-muted-foreground/30'
            )}
          >
            <div className="aspect-video bg-muted relative">
              {thumbnailUrl ? (
                <img
                  src={thumbnailUrl}
                  alt={graphic.title || 'Graphic'}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  <Paintbrush className="h-8 w-8" />
                </div>
              )}
              {selectedVideoId === graphic.id && (
                <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                  <Check className="h-4 w-4" />
                </div>
              )}
            </div>
            <div className="p-2">
              <p className="text-sm font-medium truncate">
                {graphic.title || 'Untitled Graphic'}
              </p>
              <p className="text-xs text-muted-foreground">
                {graphic.aspectRatio || '1:1'}
                {graphic.outputs?.length
                  ? ` · ${graphic.outputs.length} output${graphic.outputs.length > 1 ? 's' : ''}`
                  : ''}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );

  // --- Image · Uploaded (uploaded image assets) ---------------------------
  const imageUploadedPanel = isLoadingImageAssets ? (
    renderLoading()
  ) : isImageAssetsError ? (
    renderError('uploaded images', refetchImageAssets)
  ) : availableImageAssets.length === 0 ? (
    renderEmpty(
      searchQuery
        ? 'No images match your search'
        : 'No uploaded images yet. Upload images from the Content Library.',
      <ImageIcon className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
    )
  ) : (
    <div className={GRID_CLASS}>
      {availableImageAssets.map((asset) => (
        <button
          key={asset.id}
          type="button"
          data-testid="image-card"
          onClick={() => handleSelectImage(asset)}
          className={cn(
            CARD_CLASS,
            selectedVideoId === asset.id
              ? 'border-primary ring-2 ring-primary/20'
              : 'border-transparent hover:border-muted-foreground/30'
          )}
        >
          <div className="aspect-video bg-muted relative">
            <img
              src={asset.blobUrl}
              alt={asset.name}
              className="absolute inset-0 h-full w-full object-cover"
            />
            {selectedVideoId === asset.id && (
              <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                <Check className="h-4 w-4" />
              </div>
            )}
          </div>
          <div className="p-2">
            <p className="text-sm font-medium truncate">{asset.name}</p>
            <p className="text-xs text-muted-foreground">
              {asset.width && asset.height
                ? `${asset.width} x ${asset.height}`
                : 'Image'}
            </p>
          </div>
        </button>
      ))}
    </div>
  );

  const activePanel =
    mediaType === 'video'
      ? source === 'generated'
        ? videoGeneratedPanel
        : videoUploadedPanel
      : source === 'generated'
        ? imageGeneratedPanel
        : imageUploadedPanel;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold">Select content for your ad</h2>
        <p className="text-muted-foreground mt-1">
          Choose a video or image for your ad
        </p>
      </div>

      {/* Search */}
      <div className="space-y-2">
        <Label>Search</Label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by title..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Media type: Video / Image */}
      <Tabs
        value={mediaType}
        onValueChange={(v) => setMediaType(v as MediaType)}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="video" className="flex items-center gap-1.5">
            <Film className="h-4 w-4 shrink-0" />
            Video
          </TabsTrigger>
          <TabsTrigger value="image" className="flex items-center gap-1.5">
            <ImageIcon className="h-4 w-4 shrink-0" />
            Image
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Source: Generated / Uploaded */}
      <Tabs
        value={source}
        onValueChange={(v) => setSource(v as MediaSource)}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="generated">Generated</TabsTrigger>
          <TabsTrigger value="uploaded">Uploaded</TabsTrigger>
        </TabsList>
      </Tabs>

      <div>{activePanel}</div>

      {/* Hidden field for form validation */}
      <FormField
        control={control}
        name="videoId"
        render={() => (
          <FormItem className="hidden">
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
