import { FormField, FormItem, FormMessage } from '@/components/ui/form';
import { useCreateAsset, useListAssets } from '@/features/assets';
import { MobileSearchField, MobileSegmentedTabs } from '@/features/mobile-ui';
import type { MobileSegmentedTab } from '@/features/mobile-ui';
import { useUploadFile } from '@/features/upload';
import { ResumableUploadError } from '@/features/upload/api/resumable-upload';
import { getVideoQueryOptions, useListVideos } from '@/features/videos';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { Film, Loader2, Plus, Upload } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { toast } from 'sonner';

import type { ContentWizardFormData } from '../-schema';
import { useContentCaption } from './content-caption-context';
import {
  type ContentMediaItem,
  ContentMobileMediaGridSkeleton,
  ContentMobileMediaThumb,
} from './content-mobile-media-thumb';

type ContentMediaTab = 'videos' | 'uploads';

const CONTENT_MEDIA_TABS: MobileSegmentedTab[] = [
  { value: 'videos', label: 'Created Videos', icon: Film, ariaLabel: 'Videos' },
  {
    value: 'uploads',
    label: 'Uploaded',
    icon: Upload,
    ariaLabel: 'Uploaded content',
  },
];

const ACCEPTED_MEDIA_TYPES = 'image/*,video/*';

function MediaEmptyState({
  tab,
  searchActive,
}: {
  tab: ContentMediaTab;
  searchActive: boolean;
}) {
  const message = searchActive
    ? 'Nothing matches your search.'
    : tab === 'videos'
      ? 'No videos yet. Create a video first, or upload one under "Uploaded".'
      : 'No uploaded content yet. Tap + to upload an image or video.';
  return (
    <div className="rounded-xl border border-dashed border-[#E5E5EA] px-4 py-10 text-center">
      <p className="text-[15px] text-[#8E8E93]">{message}</p>
    </div>
  );
}

export function ContentMobileMediaStep() {
  const queryClient = useQueryClient();
  const { setValue, watch, control } = useFormContext<ContentWizardFormData>();
  const { generateCaption } = useContentCaption();
  const selectedMediaId = watch('mediaId');

  const [mediaTab, setMediaTab] = useState<ContentMediaTab>('videos');
  const [search, setSearch] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    videos,
    isLoading: isLoadingVideos,
    isError: isVideosError,
  } = useListVideos();
  const {
    assets,
    isLoading: isLoadingAssets,
    isError: isAssetsError,
  } = useListAssets();

  const { uploadAsync, isUploading } = useUploadFile({
    purpose: 'org-asset',
    showToast: false,
    onProgress: setUploadProgress,
  });
  const { createAssetAsync, isCreating } = useCreateAsset({ showToast: false });
  const isUploadingMedia = isUploading || isCreating;

  const query = search.trim().toLowerCase();

  // Created videos — ready only, newest first, matching search.
  const videoItems: ContentMediaItem[] = useMemo(
    () =>
      videos
        .filter(
          (v) =>
            v.status === 'ready' &&
            (v.title ?? '').toLowerCase().includes(query)
        )
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        .map((v) => ({
          id: v.id,
          name: v.title ?? 'Untitled video',
          thumbnailUrl: v.thumbnailUrl,
          blobUrl: v.blobUrl,
          mediaType: 'video' as const,
          durationMs: v.durationMs,
        })),
    [videos, query]
  );

  // Uploaded assets — images and videos, newest first, matching search.
  const uploadItems: ContentMediaItem[] = useMemo(
    () =>
      assets
        .filter((a) => a.name.toLowerCase().includes(query))
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        .map((a) => ({
          id: a.id,
          name: a.name,
          thumbnailUrl:
            a.thumbnailUrl ?? (a.type === 'image' ? a.blobUrl : null),
          blobUrl: a.blobUrl,
          mediaType:
            a.type === 'video' ? ('video' as const) : ('image' as const),
          durationSeconds: a.type === 'video' ? a.duration : null,
        })),
    [assets, query]
  );

  const applySelection = useCallback(
    (params: {
      id: string;
      mediaUrl: string;
      mediaType: 'image' | 'video';
      thumbnailUrl: string;
    }) => {
      setValue('mediaId', params.id);
      setValue('mediaUrl', params.mediaUrl, { shouldValidate: true });
      setValue('mediaType', params.mediaType);
      setValue('thumbnailUrl', params.thumbnailUrl);
    },
    [setValue]
  );

  const handleSelectVideo = useCallback(
    async (id: string) => {
      const video = videos.find((v) => v.id === id);
      if (!video) return;
      let url = video.blobUrl ?? '';
      // The list API omits blobUrl for performance — fetch the full video.
      if (!url) {
        try {
          const full = await queryClient.fetchQuery(getVideoQueryOptions(id));
          url = full.blobUrl ?? '';
        } catch {
          // Fall back to empty — validation surfaces the error.
        }
      }
      applySelection({
        id,
        mediaUrl: url,
        mediaType: 'video',
        thumbnailUrl: video.thumbnailUrl ?? '',
      });
      generateCaption({
        mediaType: 'video',
        mediaId: id,
        contentType: 'social-post',
      });
    },
    [videos, queryClient, applySelection, generateCaption]
  );

  const handleSelectAsset = useCallback(
    (id: string) => {
      const asset = assets.find((a) => a.id === id);
      if (!asset) return;
      const mediaType = asset.type === 'video' ? 'video' : 'image';
      applySelection({
        id,
        mediaUrl: asset.blobUrl,
        mediaType,
        thumbnailUrl: asset.thumbnailUrl ?? '',
      });
      generateCaption({
        mediaType,
        mediaId: id,
        contentType: 'social-post',
      });
    },
    [assets, applySelection, generateCaption]
  );

  const handleSelect = useCallback(
    (id: string) => {
      if (mediaTab === 'videos') {
        void handleSelectVideo(id);
      } else {
        handleSelectAsset(id);
      }
    },
    [mediaTab, handleSelectVideo, handleSelectAsset]
  );

  const uploadSelectedFile = useCallback(
    async function uploadSelectedFile(file: File) {
      const isVideo = file.type.startsWith('video/');
      const mediaType: 'image' | 'video' = isVideo ? 'video' : 'image';

      try {
        setUploadProgress(0);
        const uploadResult = await uploadAsync(file);
        const created = await createAssetAsync({
          file,
          blobUrl: uploadResult.url,
          type: mediaType,
        });
        applySelection({
          id: created.id,
          mediaUrl: created.blobUrl,
          mediaType,
          thumbnailUrl: created.thumbnailUrl ?? '',
        });
        setMediaTab('uploads');
        generateCaption({
          mediaType,
          mediaId: created.id,
          contentType: 'social-post',
        });
        toast.success('Content uploaded');
      } catch (error) {
        const resumable = error instanceof ResumableUploadError;
        toast.error(
          resumable
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Failed to upload content',
          {
            action: resumable
              ? {
                  label: 'Resume',
                  onClick: () => void uploadSelectedFile(file),
                }
              : undefined,
          }
        );
      } finally {
        setUploadProgress(null);
      }
    },
    [uploadAsync, createAssetAsync, applySelection, generateCaption]
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';
      await uploadSelectedFile(file);
    },
    [uploadSelectedFile]
  );

  const items = mediaTab === 'videos' ? videoItems : uploadItems;
  const isLoading = mediaTab === 'videos' ? isLoadingVideos : isLoadingAssets;
  // Both lists default to [] on a failed request, so the empty state told a
  // user with a full library to go create content — and there is no way past
  // this step without picking something.
  const isError = mediaTab === 'videos' ? isVideosError : isAssetsError;

  return (
    <div className="flex flex-col gap-5 px-4 pb-28">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-black">
            Select content
          </h1>
          <p className="mt-0.5 text-[14px] text-[#8E8E93]">
            Pick a video or image for your post
          </p>
        </div>
        <button
          type="button"
          aria-label="Upload content"
          data-testid="content-media-upload-button"
          disabled={isUploadingMedia}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-full bg-[#007AFF] text-white',
            'active:opacity-80 disabled:opacity-50'
          )}
        >
          {isUploadingMedia ? (
            <span className="text-[11px] font-semibold tabular-nums">
              {uploadProgress === null ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                `${uploadProgress}%`
              )}
            </span>
          ) : (
            <Plus className="size-6" strokeWidth={2.5} />
          )}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_MEDIA_TYPES}
        onChange={handleFileChange}
        data-testid="content-media-file-input"
        className="hidden"
      />

      <MobileSearchField
        value={search}
        onChange={setSearch}
        placeholder="Search content…"
      />

      <div className="-mx-4 overflow-x-auto px-4">
        <MobileSegmentedTabs
          value={mediaTab}
          onValueChange={(value) => setMediaTab(value as ContentMediaTab)}
          tabs={CONTENT_MEDIA_TABS}
          aria-label="Content type"
        />
      </div>

      {isLoading ? (
        <ContentMobileMediaGridSkeleton />
      ) : isError ? (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-6 text-center text-[15px] text-destructive">
          Couldn&apos;t load your {mediaTab === 'videos' ? 'videos' : 'uploads'}
          . Pull to refresh and try again.
        </p>
      ) : items.length === 0 ? (
        <MediaEmptyState tab={mediaTab} searchActive={query.length > 0} />
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {items.map((item) => (
            <ContentMobileMediaThumb
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
        name="mediaUrl"
        render={() => (
          <FormItem className="sr-only">
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
