import { Button } from '@/components/ui/button';
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
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useCreateAsset } from '@/features/assets/api/create-asset';
import { useGetAsset } from '@/features/assets/api/get-asset';
import { useListAssets } from '@/features/assets/api/list-assets';
import { useUploadVideo } from '@/features/upload/api/upload.hook';
import {
  AlertCircleIcon,
  CheckCircleIcon,
  ImageIcon,
  Loader2Icon,
  PlayIcon,
  UploadIcon,
  VideoIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { SlotConfig } from '../../data/-slot-config';
import { ClipPreviewDialog } from '../dialogs/clip-preview-dialog';
import { VideoThumbnail } from './video-thumbnail';

interface SingleClipSlotProps {
  slot: SlotConfig;
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function SingleClipSlot({
  slot,
  selectedId,
  onSelect,
}: SingleClipSlotProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [localSelectedId, setLocalSelectedId] = useState<string | undefined>(
    selectedId
  );
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch selected asset details for display
  const { asset: selectedAsset } = useGetAsset(selectedId || '');

  // Fetch all assets (no tag filter — users upload via content studio without specific tags)
  const { assets, isLoading, isError, refetch } = useListAssets({});

  const { createAssetAsync } = useCreateAsset();
  const { uploadAsync } = useUploadVideo({
    onProgress: (progress) => setUploadProgress(progress),
  });

  // Sync local state with prop when dialog opens
  useEffect(() => {
    if (dialogOpen) {
      setLocalSelectedId(selectedId);
    }
  }, [dialogOpen, selectedId]);

  const handleSelect = (id: string) => {
    setLocalSelectedId(id);
  };

  const handleConfirm = () => {
    onSelect(localSelectedId);
    setDialogOpen(false);
  };

  const handleCancel = () => {
    setLocalSelectedId(selectedId);
    setDialogOpen(false);
  };

  const handleClear = () => {
    onSelect(undefined);
  };

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/') && !file.type.startsWith('image/')) {
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      const uploadResult = await uploadAsync(file);

      const asset = await createAssetAsync({
        file,
        blobUrl: uploadResult.url,
        tags: ['background'],
      });

      setLocalSelectedId(asset.id);
      await refetch();
    } catch (error) {
      console.error('Failed to upload video:', error);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label>
          {slot.label}
          {slot.required && <span className="text-destructive ml-1">*</span>}
        </Label>
      </div>
      <p className="text-sm text-muted-foreground">{slot.description}</p>

      {/* Selected video preview or select button */}
      {selectedAsset ? (
        <div className="relative rounded-lg overflow-hidden border bg-muted/30 group">
          <div className="aspect-video relative">
            {selectedAsset.blobUrl ? (
              selectedAsset.type === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selectedAsset.blobUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <video
                  src={selectedAsset.blobUrl}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                  preload="metadata"
                  onLoadedData={(e) => {
                    e.currentTarget.currentTime = 0.001;
                  }}
                />
              )
            ) : (
              <div className="w-full h-full bg-muted flex items-center justify-center">
                <VideoIcon className="size-8 text-muted-foreground/40" />
              </div>
            )}
            {/* Duration badge (videos) or Photo label (images) */}
            {selectedAsset.type === 'image' ? (
              <span className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded flex items-center gap-1">
                <ImageIcon className="size-3" />
                Photo
              </span>
            ) : (
              <span className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
                {formatDuration(
                  typeof selectedAsset.duration === 'string'
                    ? Number(selectedAsset.duration)
                    : selectedAsset.duration
                )}
              </span>
            )}
          </div>
          <div className="p-2 flex items-center justify-between">
            <p className="text-sm font-medium truncate">{selectedAsset.name}</p>
            <div className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => setDialogOpen(true)}
              >
                <VideoIcon className="size-4" />
              </Button>
              {!slot.required && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive hover:text-destructive"
                  onClick={handleClear}
                >
                  <XIcon className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="w-full flex items-center gap-3 px-3 py-2 h-10 rounded-md border border-input bg-transparent text-left text-sm hover:bg-muted/50 transition-colors"
        >
          <VideoIcon className="size-4 text-muted-foreground" />
          <span className="flex-1 text-muted-foreground">
            Select {slot.label.toLowerCase()} video
          </span>
        </button>
      )}

      {/* Selection Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Select {slot.label} Video</DialogTitle>
            <DialogDescription>{slot.description}</DialogDescription>
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
                  <EmptyTitle>No videos found</EmptyTitle>
                  <EmptyDescription>
                    Upload a video for the {slot.label.toLowerCase()} slot.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button onClick={handleUploadClick} className="gap-2">
                    <UploadIcon className="size-4" />
                    Upload Video
                  </Button>
                </EmptyContent>
              </Empty>
            )}

            {!isLoading && !isError && assets.length > 0 && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {assets.map((asset) => {
                    const isSelected = localSelectedId === asset.id;
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => setPreviewAssetId(asset.id)}
                        className={`relative group text-left rounded-lg overflow-hidden border-2 transition-colors ${
                          isSelected
                            ? 'border-primary bg-primary/5'
                            : 'border-transparent hover:border-muted-foreground/20'
                        }`}
                      >
                        <div className="aspect-video bg-muted relative">
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
                          {/* Selected indicator */}
                          {isSelected && (
                            <div className="absolute top-2 right-2">
                              <CheckCircleIcon className="size-5 text-primary" />
                            </div>
                          )}
                        </div>
                        <div className="p-2">
                          <p className="text-sm font-medium truncate">
                            {asset.name}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 pt-4 border-t">
                  <Button
                    variant="outline"
                    onClick={handleUploadClick}
                    disabled={isUploading}
                    className="w-full gap-2"
                  >
                    <UploadIcon className="size-4" />
                    Upload New Video
                  </Button>
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button onClick={handleConfirm}>Select</Button>
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
        isSelected={previewAssetId === localSelectedId}
        onToggleSelect={() => {
          if (previewAssetId) handleSelect(previewAssetId);
        }}
        open={!!previewAssetId}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPreviewAssetId(null);
        }}
      />
    </div>
  );
}
