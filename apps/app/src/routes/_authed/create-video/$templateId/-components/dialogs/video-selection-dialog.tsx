import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useCreateAsset } from '@/features/assets/api/create-asset';
import { useListAssets } from '@/features/assets/api/list-assets';
import { useUploadVideo } from '@/features/upload/api/upload.hook';
import {
  AlertCircleIcon,
  ImageIcon,
  Loader2Icon,
  PlayIcon,
  UploadIcon,
  VideoIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { VideoThumbnail } from '../shared/video-thumbnail';
import { ClipPreviewDialog } from './clip-preview-dialog';

interface VideoSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  /** Custom dialog title (defaults to "Select Background Videos") */
  title?: string;
  /** Custom dialog description */
  description?: string;
  /** Maximum number of selections allowed (0 = unlimited) */
  maxCount?: number;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function VideoSelectionDialog({
  open,
  onOpenChange,
  selectedIds,
  onSelect,
  title,
  description,
  maxCount = 0,
}: VideoSelectionDialogProps) {
  const [localSelectedIds, setLocalSelectedIds] =
    useState<string[]>(selectedIds);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch all assets (no tag filter — users upload via content studio without specific tags)
  const { assets, isLoading, isError, refetch } = useListAssets({});

  const { createAssetAsync } = useCreateAsset();

  const { uploadAsync } = useUploadVideo({
    onProgress: (progress) => setUploadProgress(progress),
  });

  // Sync local state with prop when dialog opens
  useEffect(() => {
    if (open) {
      setLocalSelectedIds(selectedIds);
    }
  }, [open, selectedIds]);

  const handleToggle = (id: string) => {
    setLocalSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((i) => i !== id);
      // Enforce maxCount: if at limit, don't add more
      if (maxCount > 0 && prev.length >= maxCount) return prev;
      return [...prev, id];
    });
  };

  const isAtMax = maxCount > 0 && localSelectedIds.length >= maxCount;

  const handleConfirm = () => {
    onSelect(localSelectedIds);
    onOpenChange(false);
  };

  const handleCancel = () => {
    setLocalSelectedIds(selectedIds);
    onOpenChange(false);
  };

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('video/') && !file.type.startsWith('image/')) {
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      // Upload to S3
      const uploadResult = await uploadAsync(file);

      // Create asset record with 'background' tag
      const asset = await createAssetAsync({
        file,
        blobUrl: uploadResult.url,
        tags: ['background'],
      });

      // Add the new asset to selection
      setLocalSelectedIds((prev) => [...prev, asset.id]);

      // Refetch assets list
      await refetch();
    } catch (error) {
      console.error('Failed to upload video:', error);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{title || 'Select Background Videos'}</DialogTitle>
            <DialogDescription>
              {description ||
                'Choose videos to use as background footage. We recommend selecting at least 3 clips.'}
              {maxCount > 0 && (
                <span className="block mt-1 text-xs">
                  {localSelectedIds.length}/{maxCount} selected
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,image/*"
            onChange={handleFileSelect}
            className="hidden"
          />

          <div className="flex-1 overflow-y-auto py-4">
            {/* Upload progress */}
            {isUploading && (
              <div className="mb-4 p-4 border rounded-lg bg-muted/50">
                <div className="flex items-center gap-3 mb-2">
                  <Loader2Icon className="size-4 animate-spin" />
                  <span className="text-sm font-medium">
                    Uploading video...
                  </span>
                </div>
                <Progress value={uploadProgress} className="h-2" />
                <p className="text-xs text-muted-foreground mt-1">
                  {uploadProgress}%
                </p>
              </div>
            )}

            {isLoading && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <div key={`video-skeleton-${n}`} className="space-y-2">
                    <Skeleton className="aspect-video w-full rounded-lg" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                ))}
              </div>
            )}

            {isError && (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <AlertCircleIcon className="size-12 mb-4" />
                <p>Failed to load videos. Please try again.</p>
              </div>
            )}

            {!isLoading && !isError && assets.length === 0 && !isUploading && (
              <Empty className="py-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <VideoIcon />
                  </EmptyMedia>
                  <EmptyTitle>No background videos found</EmptyTitle>
                  <EmptyDescription>
                    Upload videos to use as background footage for your video.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button onClick={handleUploadClick} className="gap-2">
                    <UploadIcon className="size-4" />
                    Upload Background Video
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Videos will be automatically tagged as background footage.
                  </p>
                </EmptyContent>
              </Empty>
            )}

            {!isLoading && !isError && assets.length > 0 && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {assets.map((asset) => {
                    const isSelected = localSelectedIds.includes(asset.id);
                    return (
                      <div
                        key={asset.id}
                        className={`relative group text-left rounded-lg overflow-hidden border-2 transition-colors ${
                          isSelected
                            ? 'border-primary bg-primary/5'
                            : 'border-transparent hover:border-muted-foreground/20'
                        }`}
                      >
                        {/* Video thumbnail — click opens preview */}
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setPreviewAssetId(asset.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setPreviewAssetId(asset.id);
                            }
                          }}
                          className="aspect-video bg-muted relative cursor-pointer"
                        >
                          {asset.blobUrl ? (
                            <VideoThumbnail
                              src={asset.blobUrl}
                              className="w-full h-full"
                              isImage={asset.type === 'image'}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <VideoIcon className="size-8 text-muted-foreground/40" />
                            </div>
                          )}
                          {/* Play icon overlay (videos only) */}
                          {asset.type !== 'image' && (
                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                              <div className="bg-black/60 rounded-full p-2">
                                <PlayIcon className="size-5 text-white" />
                              </div>
                            </div>
                          )}
                          {/* Duration badge (videos) or Photo label (images) */}
                          {asset.type === 'image' ? (
                            <span className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded flex items-center gap-1">
                              <ImageIcon className="size-3" />
                              Photo
                            </span>
                          ) : (
                            <span className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
                              {formatDuration(
                                typeof asset.duration === 'string'
                                  ? Number(asset.duration)
                                  : asset.duration
                              )}
                            </span>
                          )}
                          {/* Checkbox overlay — click toggles selection without opening preview */}
                          <div
                            className="absolute top-2 left-2"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <Checkbox
                              checked={isSelected}
                              disabled={!isSelected && isAtMax}
                              onCheckedChange={() => handleToggle(asset.id)}
                              className="bg-white"
                            />
                          </div>
                        </div>
                        {/* Video name */}
                        <div className="p-2">
                          <p className="text-sm font-medium truncate">
                            {asset.name}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Upload more button when videos exist */}
                <div className="mt-4 pt-4 border-t">
                  <Button
                    variant="outline"
                    onClick={handleUploadClick}
                    disabled={isUploading}
                    className="w-full gap-2"
                  >
                    <UploadIcon className="size-4" />
                    Upload More Videos
                  </Button>
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={localSelectedIds.length === 0}
            >
              Select{' '}
              {localSelectedIds.length > 0
                ? `(${localSelectedIds.length})`
                : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clip preview dialog — must be outside parent Dialog to avoid Radix nesting issues */}
      <ClipPreviewDialog
        asset={
          previewAssetId
            ? (assets.find((a) => a.id === previewAssetId) ?? null)
            : null
        }
        isSelected={
          previewAssetId ? localSelectedIds.includes(previewAssetId) : false
        }
        onToggleSelect={() => {
          if (previewAssetId) handleToggle(previewAssetId);
        }}
        open={!!previewAssetId}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPreviewAssetId(null);
        }}
      />
    </>
  );
}
