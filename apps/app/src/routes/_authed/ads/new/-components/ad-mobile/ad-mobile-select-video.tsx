import { FormField, FormItem, FormMessage } from '@/components/ui/form';
import { useCreateAsset, useListAssets } from '@/features/assets';
import { useListGraphics } from '@/features/graphics';
import { MobileSegmentedTabs } from '@/features/mobile-ui';
import { useUploadFile } from '@/features/upload';
import { useGetVideo, useListVideos } from '@/features/videos';
import { cn } from '@/lib/utils';
import { Loader2, Paintbrush, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { toast } from 'sonner';

import { useAdWizard } from '../../-context';
import { useNewAdSearch } from '../../-hooks/use-new-ad-search';
import type { AdWizardFormData } from '../../-schema';
import {
  AD_MOBILE_MEDIA_FILTER_TABS,
  AD_MOBILE_MEDIA_SOURCE_TABS,
  type AdMobileMediaSource,
  type AdMobileMediaTab,
} from './ad-mobile-media-filter-tabs';
import { getGraphicThumbnail } from './ad-mobile-media-utils';
import {
  AdMobileVideoGridSkeleton,
  type AdMobileVideoItem,
  AdMobileVideoThumb,
} from './ad-mobile-video-thumb';

const ACCEPTED_VIDEO_TYPES = '.mp4,.mov,.webm';

const byNewestCreated = <T extends { createdAt: string }>(a: T, b: T) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

function MediaEmptyState({
  tab,
  source,
  onUpload,
  isUploading,
}: {
  tab: AdMobileMediaTab;
  source: AdMobileMediaSource;
  onUpload?: () => void;
  isUploading?: boolean;
}) {
  const messages: Record<
    AdMobileMediaTab,
    Record<AdMobileMediaSource, string>
  > = {
    videos: {
      generated: 'No videos yet. Create a video to get started.',
      uploaded: 'No uploaded videos yet. Tap + to upload one.',
    },
    graphics: {
      generated: 'No graphics yet. Create graphics from the Graphics section.',
      uploaded: 'No uploaded images yet. Upload them from the Content Library.',
    },
  };

  return (
    <div className="rounded-xl border border-dashed border-[#E5E5EA] px-4 py-10 text-center">
      {tab === 'graphics' ? (
        <Paintbrush className="mx-auto mb-3 size-10 text-[#C7C7CC]" />
      ) : null}
      <p className="text-[15px] text-[#8E8E93]">{messages[tab][source]}</p>
      {tab === 'videos' && onUpload ? (
        <button
          type="button"
          disabled={isUploading}
          onClick={onUpload}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#007AFF] px-4 py-2 text-[15px] font-semibold text-white disabled:opacity-50"
        >
          {isUploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          {isUploading ? 'Uploading…' : 'Upload video'}
        </button>
      ) : null}
    </div>
  );
}

export function AdMobileSelectVideo() {
  const { videoId: preselectedVideoId } = useNewAdSearch();
  const { setValue, watch, control } = useFormContext<AdWizardFormData>();
  const selectedMediaId = watch('videoId');
  const [mediaTab, setMediaTab] = useState<AdMobileMediaTab>('videos');
  const [source, setSource] = useState<AdMobileMediaSource>('generated');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { setSelectedVideo } = useAdWizard();
  const { videos, isLoading: isLoadingVideos } = useListVideos();
  const { video: fetchedPreselectedVideo } = useGetVideo(
    preselectedVideoId ?? '',
    {
      enabled: Boolean(preselectedVideoId),
    }
  );
  const { assets: videoAssets, isLoading: isLoadingVideoAssets } =
    useListAssets({ type: 'video' });
  const { assets: imageAssets, isLoading: isLoadingImageAssets } =
    useListAssets({ type: 'image' });
  const { graphics, isLoading: isLoadingGraphics } = useListGraphics({
    status: 'ready',
  });

  const { uploadAsync, isUploading } = useUploadFile({
    purpose: 'org-asset',
    showToast: false,
  });
  const { createAssetAsync, isCreating } = useCreateAsset({ showToast: false });
  const isUploadingVideo = isUploading || isCreating;

  const readyVideos = useMemo(
    () => videos.filter((v) => v.status === 'ready'),
    [videos]
  );

  // Videos · Generated — videos we created.
  const videoGeneratedItems: AdMobileVideoItem[] = useMemo(
    () =>
      [...readyVideos].sort(byNewestCreated).map((v) => ({
        id: v.id,
        thumbnailUrl: v.thumbnailUrl,
        blobUrl: v.blobUrl,
        durationMs: v.durationMs,
        isVideoPreview: true,
      })),
    [readyVideos]
  );

  // Videos · Uploaded — the org's uploaded video assets. Prefer the asset's
  // own thumbnail (same field the content gallery uses) so tiles render a real
  // poster instead of an unpainted <video> placeholder.
  const videoUploadedItems: AdMobileVideoItem[] = useMemo(
    () =>
      [...videoAssets].sort(byNewestCreated).map((a) => ({
        id: a.id,
        thumbnailUrl: a.thumbnailUrl ?? null,
        blobUrl: a.blobUrl,
        durationSeconds: a.duration,
        isVideoPreview: true,
      })),
    [videoAssets]
  );

  // Graphics · Generated — rendered graphics.
  const graphicGeneratedItems: AdMobileVideoItem[] = useMemo(
    () =>
      [...graphics].sort(byNewestCreated).map((g) => {
        const thumbnailUrl = getGraphicThumbnail(g);
        return {
          id: g.id,
          thumbnailUrl,
          blobUrl: thumbnailUrl,
          isVideoPreview: false,
        };
      }),
    [graphics]
  );

  // Graphics · Uploaded — the org's uploaded image assets.
  const graphicUploadedItems: AdMobileVideoItem[] = useMemo(
    () =>
      [...imageAssets].sort(byNewestCreated).map((a) => ({
        id: a.id,
        thumbnailUrl: a.thumbnailUrl ?? a.blobUrl,
        blobUrl: a.blobUrl,
        isVideoPreview: false,
        durationSeconds: null,
      })),
    [imageAssets]
  );

  const handleSelectVideo = useCallback(
    (videoId: string) => {
      const video = readyVideos.find((v) => v.id === videoId);
      if (!video) return;
      setValue('videoId', video.id, { shouldValidate: true });
      setSelectedVideo(video);
    },
    [readyVideos, setValue, setSelectedVideo]
  );

  useEffect(() => {
    if (!preselectedVideoId) return;
    const video =
      readyVideos.find((v) => v.id === preselectedVideoId) ??
      (fetchedPreselectedVideo?.status === 'ready'
        ? fetchedPreselectedVideo
        : undefined);
    if (!video) return;
    setMediaTab('videos');
    setSource('generated');
    setValue('videoId', video.id, { shouldValidate: true });
    setSelectedVideo(video);
  }, [
    preselectedVideoId,
    readyVideos,
    fetchedPreselectedVideo,
    setValue,
    setSelectedVideo,
  ]);

  const handleSelectVideoAsset = useCallback(
    (assetId: string) => {
      const asset = videoAssets.find((a) => a.id === assetId);
      if (!asset) return;
      setValue('videoId', asset.id, { shouldValidate: true });
      setSelectedVideo({
        id: asset.id,
        title: asset.name,
        thumbnailUrl: asset.thumbnailUrl ?? asset.blobUrl,
        blobUrl: asset.blobUrl,
        durationMs: asset.duration
          ? String(Number(asset.duration) * 1000)
          : null,
      });
    },
    [videoAssets, setValue, setSelectedVideo]
  );

  const handleSelectImage = useCallback(
    (assetId: string) => {
      const asset = imageAssets.find((a) => a.id === assetId);
      if (!asset) return;
      setValue('videoId', asset.id, { shouldValidate: true });
      setSelectedVideo({
        id: asset.id,
        title: asset.name,
        thumbnailUrl: asset.blobUrl,
        blobUrl: asset.blobUrl,
      });
    },
    [imageAssets, setValue, setSelectedVideo]
  );

  const handleSelectGraphic = useCallback(
    (graphicId: string) => {
      const graphic = graphics.find((g) => g.id === graphicId);
      if (!graphic) return;
      const thumbnailUrl = getGraphicThumbnail(graphic);
      setValue('videoId', graphic.id, { shouldValidate: true });
      setSelectedVideo({
        id: graphic.id,
        title: graphic.title,
        thumbnailUrl,
        blobUrl: thumbnailUrl,
      });
    },
    [graphics, setValue, setSelectedVideo]
  );

  const handleSelect = useCallback(
    (id: string) => {
      if (mediaTab === 'videos') {
        if (readyVideos.some((v) => v.id === id)) {
          handleSelectVideo(id);
        } else {
          handleSelectVideoAsset(id);
        }
        return;
      }
      if (graphics.some((g) => g.id === id)) {
        handleSelectGraphic(id);
      } else {
        handleSelectImage(id);
      }
    },
    [
      mediaTab,
      readyVideos,
      graphics,
      handleSelectVideo,
      handleSelectVideoAsset,
      handleSelectGraphic,
      handleSelectImage,
    ]
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';

      try {
        const uploadResult = await uploadAsync(file);
        const created = await createAssetAsync({
          file,
          blobUrl: uploadResult.url,
          type: 'video',
        });
        setValue('videoId', created.id, { shouldValidate: true });
        setSelectedVideo({
          id: created.id,
          title: created.name,
          thumbnailUrl: created.blobUrl,
          blobUrl: created.blobUrl,
          durationMs: created.duration
            ? String(Number(created.duration) * 1000)
            : null,
        });
        setMediaTab('videos');
        setSource('uploaded');
        toast.success('Video uploaded');
      } catch {
        toast.error('Failed to upload video');
      }
    },
    [uploadAsync, createAssetAsync, setValue, setSelectedVideo]
  );

  const isLoading =
    mediaTab === 'videos'
      ? source === 'generated'
        ? isLoadingVideos
        : isLoadingVideoAssets
      : source === 'generated'
        ? isLoadingGraphics
        : isLoadingImageAssets;

  const items =
    mediaTab === 'videos'
      ? source === 'generated'
        ? videoGeneratedItems
        : videoUploadedItems
      : source === 'generated'
        ? graphicGeneratedItems
        : graphicUploadedItems;
  const showUploadButton = mediaTab === 'videos';

  return (
    <div
      className="flex flex-col gap-5 px-4 pb-28"
      data-claire-target="ads-new-media-picker"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-black">
            Select media
          </h1>
          <p className="mt-0.5 text-[14px] text-[#8E8E93]">
            Video or graphic for your ad
          </p>
        </div>
        {showUploadButton ? (
          <button
            type="button"
            aria-label="Upload video"
            disabled={isUploadingVideo}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-full bg-[#007AFF] text-white',
              'active:opacity-80 disabled:opacity-50'
            )}
          >
            {isUploadingVideo ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Plus className="size-6" strokeWidth={2.5} />
            )}
          </button>
        ) : null}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_VIDEO_TYPES}
        onChange={handleFileChange}
        className="hidden"
      />

      <div className="flex flex-col gap-3">
        <div className="-mx-4 overflow-x-auto px-4">
          <MobileSegmentedTabs
            value={mediaTab}
            onValueChange={(value) => setMediaTab(value as AdMobileMediaTab)}
            tabs={AD_MOBILE_MEDIA_FILTER_TABS}
            aria-label="Media type"
          />
        </div>
        <div className="-mx-4 overflow-x-auto px-4">
          <MobileSegmentedTabs
            value={source}
            onValueChange={(value) => setSource(value as AdMobileMediaSource)}
            tabs={AD_MOBILE_MEDIA_SOURCE_TABS}
            aria-label="Media source"
          />
        </div>
      </div>

      {isLoading ? (
        <AdMobileVideoGridSkeleton />
      ) : items.length === 0 ? (
        <MediaEmptyState
          tab={mediaTab}
          source={source}
          onUpload={
            mediaTab === 'videos'
              ? () => fileInputRef.current?.click()
              : undefined
          }
          isUploading={isUploadingVideo}
        />
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {items.map((item) => (
            <AdMobileVideoThumb
              key={item.id}
              item={item}
              selected={selectedMediaId === item.id}
              onSelect={() => handleSelect(item.id)}
            />
          ))}
        </div>
      )}

      <FormField
        control={control}
        name="videoId"
        render={() => (
          <FormItem className="sr-only">
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
