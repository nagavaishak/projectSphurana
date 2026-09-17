import {
  Dropzone,
  DropzoneContent,
  DropzoneEmptyState,
} from '@/components/kibo-ui/dropzone';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { CheckCircle2, ImageIcon, Loader2, Video, X } from 'lucide-react';
import { useRef } from 'react';
import { useUploadContext } from '../upload-context';
import type { UploadedAsset } from '../upload-context';

const ACCEPTED_MEDIA_TYPES = {
  'video/mp4': ['.mp4'],
  'video/quicktime': ['.mov'],
  'video/webm': ['.webm'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
};

function AssetItem({
  asset,
  onRemove,
}: {
  asset: UploadedAsset;
  onRemove: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isImage = asset.file.type.startsWith('image/');

  return (
    <Card className="p-3">
      <div className="flex gap-4">
        <div
          className="group relative size-[80px] shrink-0 overflow-hidden rounded-lg bg-muted"
          onMouseEnter={() => {
            if (!isImage) videoRef.current?.play();
          }}
          onMouseLeave={() => {
            if (!isImage && videoRef.current) {
              videoRef.current.pause();
              videoRef.current.currentTime = 0;
            }
          }}
        >
          {isImage ? (
            <img
              src={asset.objectUrl}
              alt={asset.file.name}
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <video
              ref={videoRef}
              src={asset.objectUrl}
              className="absolute inset-0 size-full object-cover"
              muted
              loop
              playsInline
              preload="metadata"
              onLoadedData={(e) => {
                e.currentTarget.currentTime = 0.001;
              }}
            />
          )}
          {(asset.status === 'uploading' || asset.status === 'processing') && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <Loader2 className="size-5 animate-spin text-white" />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-sm font-medium">{asset.file.name}</p>
            <div className="shrink-0">
              {asset.status === 'complete' && (
                <CheckCircle2 className="size-4 text-green-600" />
              )}
              {asset.status === 'error' && (
                <button
                  type="button"
                  onClick={onRemove}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="size-4" />
                </button>
              )}
              {(asset.status === 'uploading' ||
                asset.status === 'processing' ||
                asset.status === 'analyzing') && (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>

          {(asset.status === 'uploading' || asset.status === 'processing') && (
            <div className="space-y-1">
              <Progress value={asset.progress} className="h-1.5" />
              <p className="text-xs text-muted-foreground">
                {asset.status === 'uploading'
                  ? `Uploading... ${asset.progress}%`
                  : 'Processing...'}
              </p>
            </div>
          )}

          {asset.status === 'analyzing' && (
            <p className="text-xs text-muted-foreground">
              Analyzing content...
            </p>
          )}

          {asset.status === 'error' && (
            <p className="text-xs text-destructive">
              {asset.error || 'Upload failed'}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

export function StepUpload() {
  const {
    uploadedAssets,
    addFiles,
    removeAsset,
    completedCount,
    processingCount,
  } = useUploadContext();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold">Upload your assets</h2>
        <p className="mt-1 text-muted-foreground">
          Drop your videos and images here. Our AI will analyze and categorize
          each one automatically.
        </p>
      </div>

      <Dropzone
        accept={ACCEPTED_MEDIA_TYPES}
        maxFiles={50}
        maxSize={600 * 1024 * 1024}
        onDrop={addFiles}
        className={cn(
          'min-h-[160px] border-2 border-dashed',
          uploadedAssets.length > 0 && 'min-h-[120px]'
        )}
      >
        <DropzoneEmptyState>
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-full bg-muted p-3">
              <div className="flex gap-1">
                <Video className="size-5 text-muted-foreground" />
                <ImageIcon className="size-5 text-muted-foreground" />
              </div>
            </div>
            <div className="text-center">
              <p className="font-medium">Drop your files here</p>
              <p className="text-sm text-muted-foreground">
                Videos (MP4, MOV, WebM) and images (JPG, PNG, WebP)
              </p>
            </div>
          </div>
        </DropzoneEmptyState>
        <DropzoneContent />
      </Dropzone>

      {uploadedAssets.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              {completedCount} of {uploadedAssets.length} analyzed
            </Badge>
            {processingCount > 0 && (
              <Badge variant="outline">
                <Loader2 className="mr-1 size-3 animate-spin" />
                {processingCount} in progress
              </Badge>
            )}
          </div>

          <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
            {uploadedAssets.map((asset) => (
              <AssetItem
                key={asset.id}
                asset={asset}
                onRemove={() => removeAsset(asset.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
