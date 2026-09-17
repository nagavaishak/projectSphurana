import {
  Dropzone,
  DropzoneContent,
  DropzoneEmptyState,
} from '@/components/kibo-ui/dropzone';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  formatTag,
  useAddAssetTags,
  useCreateAsset,
  useReanalyzeAsset,
  useRemoveAssetTags,
} from '@/features/assets';
import { useAnalysisTrackerStore } from '@/features/assets/background-analysis';
import { useUploadVideo } from '@/features/upload';
import { cn } from '@/lib/utils';
import { CheckCircle2, Loader2, Plus, Sparkles, Video, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';

interface Step5ContentUploadProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
}

interface UploadedVideo {
  id: string;
  file: File;
  objectUrl: string;
  status: 'uploading' | 'processing' | 'analyzing' | 'complete' | 'error';
  progress: number;
  assetId?: string;
  tags: string[];
  error?: string;
}

const ACCEPTED_VIDEO_TYPES = {
  'video/mp4': ['.mp4'],
  'video/quicktime': ['.mov'],
  'video/webm': ['.webm'],
};

// Wave animation keyframes injected via style tag
const waveKeyframes = `
@keyframes wave-text {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-3px); }
}
`;

function GeneratingBadge() {
  const text = 'Generating...';
  return (
    <>
      <style>{waveKeyframes}</style>
      <Badge variant="secondary" className="gap-1.5">
        <Sparkles className="size-3 text-amber-500" />
        <span className="flex">
          {text.split('').map((char, i) => (
            <span
              key={`${char}-${i}`}
              className="inline-block"
              style={{
                animation: 'wave-text 1.2s ease-in-out infinite',
                animationDelay: `${i * 50}ms`,
              }}
            >
              {char}
            </span>
          ))}
        </span>
      </Badge>
    </>
  );
}

interface VideoItemProps {
  video: UploadedVideo;
  onRemoveTag: (videoId: string, tag: string) => void;
  onAddTag: () => void;
  onRemove: () => void;
}

function VideoItem({ video, onRemoveTag, onAddTag, onRemove }: VideoItemProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleMouseEnter = () => {
    videoRef.current?.play();
  };

  const handleMouseLeave = () => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  };

  return (
    <Card className="p-3">
      <div className="flex gap-4">
        {/* LEFT: Square Video Preview */}
        <div
          className="group relative size-[100px] shrink-0 overflow-hidden rounded-lg bg-muted"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <video
            ref={videoRef}
            src={video.objectUrl}
            className="absolute inset-0 size-full object-cover"
            muted
            loop
            playsInline
            preload="metadata"
            onLoadedData={(e) => {
              e.currentTarget.currentTime = 0.001;
            }}
          />
          {/* Loading overlay for uploading state */}
          {(video.status === 'uploading' || video.status === 'processing') && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <Loader2 className="size-6 animate-spin text-white" />
            </div>
          )}
        </div>

        {/* RIGHT: Content Stack */}
        <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
          {/* Top: File name + status icon */}
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-sm font-medium">{video.file.name}</p>
            <div className="shrink-0">
              {video.status === 'complete' && (
                <CheckCircle2 className="size-4 text-green-600" />
              )}
              {video.status === 'error' && (
                <button
                  type="button"
                  onClick={onRemove}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="size-4" />
                </button>
              )}
              {(video.status === 'uploading' ||
                video.status === 'processing' ||
                video.status === 'analyzing') && (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>

          {/* Middle: Progress bar for uploading/processing */}
          {(video.status === 'uploading' || video.status === 'processing') && (
            <div className="space-y-1">
              <Progress value={video.progress} className="h-1.5" />
              <p className="text-xs text-muted-foreground">
                {video.status === 'uploading'
                  ? `Uploading... ${video.progress}%`
                  : 'Processing...'}
              </p>
            </div>
          )}

          {/* Error state */}
          {video.status === 'error' && (
            <p className="text-xs text-destructive">
              {video.error || 'Upload failed'}
            </p>
          )}

          {/* Bottom: Tags Section */}
          {(video.status === 'analyzing' || video.status === 'complete') && (
            <div className="mt-auto flex flex-wrap gap-1.5">
              {video.status === 'analyzing' ? (
                <GeneratingBadge />
              ) : (
                <>
                  {video.tags.length === 0 && (
                    <span className="text-xs text-muted-foreground">
                      No tags generated
                    </span>
                  )}
                  {video.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                      {formatTag(tag)}
                      <button
                        type="button"
                        onClick={() => onRemoveTag(video.id, tag)}
                        className="rounded-full hover:bg-muted-foreground/20"
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                  {/* Add tag button */}
                  <button
                    type="button"
                    onClick={onAddTag}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/50 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    <Plus className="size-3" />
                    Add
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

interface AddTagDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (tag: string) => void;
}

function AddTagDialog({ isOpen, onOpenChange, onSubmit }: AddTagDialogProps) {
  const [tagValue, setTagValue] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = tagValue.trim();
    if (trimmed) {
      onSubmit(trimmed);
      setTagValue('');
      onOpenChange(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setTagValue('');
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Add Tag</DialogTitle>
          <DialogDescription>
            Add a custom tag to help categorize this video.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="py-4">
            <Input
              value={tagValue}
              onChange={(e) => setTagValue(e.target.value)}
              placeholder="Enter tag name"
              autoFocus
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!tagValue.trim()}>
              Add Tag
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function Step5ContentUpload({ form }: Step5ContentUploadProps) {
  const [uploadedVideos, setUploadedVideos] = useState<UploadedVideo[]>([]);
  const [addTagDialogState, setAddTagDialogState] = useState<{
    isOpen: boolean;
    videoId: string | null;
  }>({ isOpen: false, videoId: null });

  const trackAnalysis = useAnalysisTrackerStore((state) => state.track);
  const untrackAnalysis = useAnalysisTrackerStore((state) => state.untrack);
  const trackedAnalyses = useAnalysisTrackerStore((state) => state.tracked);

  const { createAssetAsync } = useCreateAsset();
  const { reanalyzeAssetAsync } = useReanalyzeAsset();
  const { addTagsAsync } = useAddAssetTags();
  const { removeTagsAsync } = useRemoveAssetTags();
  const { uploadAsync: uploadVideoAsync } = useUploadVideo({
    purpose: 'org-asset',
  });

  const updateVideo = useCallback(
    (id: string, updates: Partial<Omit<UploadedVideo, 'id' | 'file'>>) => {
      setUploadedVideos((prev) =>
        prev.map((v) => (v.id === id ? { ...v, ...updates } : v))
      );
    },
    []
  );

  // Cleanup object URLs on unmount
  // biome-ignore lint/correctness/useExhaustiveDependencies: Intentional - capture videos at mount for cleanup on unmount
  useEffect(() => {
    return () => {
      for (const video of uploadedVideos) {
        URL.revokeObjectURL(video.objectUrl);
      }
    };
  }, []);

  // Hand analysis off to the app-wide tracker so it survives leaving this
  // onboarding step.
  useEffect(() => {
    const toTrack = uploadedVideos
      .filter((v) => v.status === 'analyzing' && v.assetId)
      .map((v) => ({ assetId: v.assetId as string, label: v.file.name }));

    if (toTrack.length > 0) trackAnalysis(toTrack);
  }, [uploadedVideos, trackAnalysis]);

  // Mirror tracker outcomes into local state for a user who stayed here.
  useEffect(() => {
    for (const v of uploadedVideos) {
      if (v.status !== 'analyzing' || !v.assetId) continue;

      const entry = trackedAnalyses[v.assetId];
      if (!entry || entry.status === 'pending') continue;

      if (entry.status === 'completed') {
        updateVideo(v.id, { status: 'complete', tags: entry.tags });
      } else if (entry.status === 'failed') {
        updateVideo(v.id, { status: 'error', error: 'Tag generation failed' });
      } else {
        updateVideo(v.id, {
          status: 'complete',
          tags: [],
          error: 'Tag generation is taking longer than expected',
        });
      }
    }
  }, [trackedAnalyses, uploadedVideos, updateVideo]);

  const processVideo = useCallback(
    async (file: File) => {
      const videoId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const objectUrl = URL.createObjectURL(file);

      // Add to list
      setUploadedVideos((prev) => [
        ...prev,
        {
          id: videoId,
          file,
          objectUrl,
          status: 'uploading',
          progress: 0,
          tags: [],
        },
      ]);

      try {
        // Upload to S3
        const uploadResult = await uploadVideoAsync(file);
        updateVideo(videoId, { progress: 50, status: 'processing' });

        // Create asset. useCreateAsset takes a typed INTENT — buildCreateAssetPayload
        // derives name / sourceFileName from the File and assembles the one
        // canonical wire body. See features/assets/api/create-asset.
        const asset = await createAssetAsync({
          file,
          blobUrl: uploadResult.url,
          type: 'video',
          tags: [],
        });
        updateVideo(videoId, { progress: 75, assetId: asset.id });

        // Queue analysis
        await reanalyzeAssetAsync(asset.id);
        updateVideo(videoId, {
          progress: 100,
          status: 'analyzing',
          assetId: asset.id,
        });
      } catch (error) {
        updateVideo(videoId, {
          status: 'error',
          error: error instanceof Error ? error.message : 'Upload failed',
        });
      }
    },
    [uploadVideoAsync, createAssetAsync, reanalyzeAssetAsync, updateVideo]
  );

  const handleDrop = useCallback(
    (acceptedFiles: File[]) => {
      for (const file of acceptedFiles) {
        processVideo(file);
      }
      // Update form with uploaded count
      form.setValue(
        'uploadedContentCount',
        uploadedVideos.length + acceptedFiles.length
      );
    },
    [processVideo, form, uploadedVideos.length]
  );

  const removeVideo = useCallback(
    (id: string) => {
      setUploadedVideos((prev) => {
        const video = prev.find((v) => v.id === id);
        if (video) {
          URL.revokeObjectURL(video.objectUrl);
        }
        if (video?.assetId) untrackAnalysis([video.assetId]);
        return prev.filter((v) => v.id !== id);
      });
    },
    [untrackAnalysis]
  );

  const handleRemoveTag = useCallback(
    async (videoId: string, tag: string) => {
      const video = uploadedVideos.find((v) => v.id === videoId);
      if (!video?.assetId) return;

      try {
        await removeTagsAsync({ assetId: video.assetId, tags: [tag] });
        updateVideo(videoId, {
          tags: video.tags.filter((t) => t !== tag),
        });
      } catch {
        // Toast error is handled by the hook
      }
    },
    [uploadedVideos, removeTagsAsync, updateVideo]
  );

  const openAddTagDialog = (videoId: string) => {
    setAddTagDialogState({ isOpen: true, videoId });
  };

  const handleAddTagSubmit = async (tag: string) => {
    if (!addTagDialogState.videoId) return;

    const video = uploadedVideos.find(
      (v) => v.id === addTagDialogState.videoId
    );
    if (!video?.assetId) return;

    try {
      await addTagsAsync({ assetId: video.assetId, tags: [tag] });
      updateVideo(addTagDialogState.videoId, {
        tags: [...video.tags, tag],
      });
    } catch {
      // Toast error is handled by the hook
    }
  };

  const completedCount = uploadedVideos.filter(
    (v) => v.status === 'complete'
  ).length;
  const processingCount = uploadedVideos.filter(
    (v) =>
      v.status === 'uploading' ||
      v.status === 'processing' ||
      v.status === 'analyzing'
  ).length;

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Upload your content</h1>
        <p className="text-muted-foreground">
          Upload videos of your work. Our AI will automatically generate tags
          for you.
        </p>
      </div>

      {/* Dropzone */}
      <Dropzone
        accept={ACCEPTED_VIDEO_TYPES}
        maxFiles={50}
        maxSize={600 * 1024 * 1024}
        onDrop={handleDrop}
        className={cn(
          'min-h-[180px] border-2 border-dashed',
          uploadedVideos.length > 0 && 'min-h-[140px]'
        )}
      >
        <DropzoneEmptyState>
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-full bg-muted p-3">
              <Video className="size-6 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="font-medium">Drop your videos here</p>
              <p className="text-sm text-muted-foreground">
                MP4, MOV, WebM - up to 10 minutes each
              </p>
            </div>
          </div>
        </DropzoneEmptyState>
        <DropzoneContent />
      </Dropzone>

      {/* Video List */}
      {uploadedVideos.length > 0 && (
        <div className="space-y-3">
          {/* Status Summary */}
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              {completedCount} of {uploadedVideos.length} processed
            </Badge>
            {processingCount > 0 && (
              <Badge variant="outline">
                <Loader2 className="mr-1 size-3 animate-spin" />
                {processingCount} in progress
              </Badge>
            )}
          </div>

          {/* Video Items */}
          <div className="max-h-[350px] space-y-2 overflow-y-auto pr-1">
            {uploadedVideos.map((video) => (
              <VideoItem
                key={video.id}
                video={video}
                onRemoveTag={handleRemoveTag}
                onAddTag={() => openAddTagDialog(video.id)}
                onRemove={() => removeVideo(video.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Add Tag Dialog */}
      <AddTagDialog
        isOpen={addTagDialogState.isOpen}
        onOpenChange={(open) =>
          setAddTagDialogState((s) => ({ ...s, isOpen: open }))
        }
        onSubmit={handleAddTagSubmit}
      />

      <p className="text-center text-xs text-muted-foreground">
        This step is optional. You can upload content anytime from your
        dashboard.
      </p>
    </FieldGroup>
  );
}
