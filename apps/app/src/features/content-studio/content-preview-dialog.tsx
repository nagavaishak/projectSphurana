import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import {
  type Asset,
  assetAnalysisStatusLabels,
  assetContentTypeLabels,
  useGetAssetAnalysis,
} from '@/features/assets';
import { type Video, useGetVideo } from '@/features/videos';
import { formatDistanceToNow } from 'date-fns';
import {
  Check,
  Clock,
  Download,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  SendIcon,
  Trash2,
  Video as VideoIcon,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { PostContentDialog } from './post-content-dialog';

// ─── Discriminated union for the two content types ───

type ContentItem =
  | { kind: 'asset'; data: Asset }
  | { kind: 'video'; data: Video };

interface ContentPreviewDialogProps {
  item: ContentItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete?: (item: ContentItem) => void;
  isDeleting?: boolean;
}

// ─── Helpers ───

function AnalysisStatusBadge({
  status,
}: {
  status: 'queued' | 'processing' | 'completed' | 'failed' | null;
}) {
  if (!status) {
    return (
      <Badge variant="outline" className="gap-1">
        <Clock className="size-3" />
        Not analyzed
      </Badge>
    );
  }

  const variants: Record<
    string,
    'default' | 'secondary' | 'destructive' | 'outline'
  > = {
    queued: 'outline',
    processing: 'secondary',
    completed: 'default',
    failed: 'destructive',
  };

  const icons: Record<string, React.ReactNode> = {
    queued: <Clock className="size-3" />,
    processing: <Loader2 className="size-3 animate-spin" />,
    completed: <Check className="size-3" />,
    failed: <X className="size-3" />,
  };

  return (
    <Badge variant={variants[status]} className="gap-1">
      {icons[status]}
      {assetAnalysisStatusLabels[status]}
    </Badge>
  );
}

// ─── Asset detail section ───

function AssetDetails({ asset }: { asset: Asset }) {
  const { analysis, linkedServices, isLoading, refetch } = useGetAssetAnalysis(
    asset.id
  );

  return (
    <>
      <Separator />

      {/* Analysis Status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Analysis Status</span>
          <AnalysisStatusBadge status={analysis?.status ?? null} />
        </div>
        {analysis?.status !== 'processing' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw
              className={`size-4 ${isLoading ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>
        )}
      </div>

      {/* Content Type */}
      {analysis?.contentType && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Content Type</h4>
          <Badge variant="outline">
            {assetContentTypeLabels[
              analysis.contentType as keyof typeof assetContentTypeLabels
            ] ?? analysis.contentType}
          </Badge>
        </div>
      )}

      {/* Linked Services */}
      {linkedServices.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Linked Services</h4>
          <div className="flex flex-wrap gap-2">
            {linkedServices.map((service) => (
              <Badge key={service.id} variant="outline">
                {service.serviceName}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* File Info */}
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>File: {asset.sourceFileName}</p>
        <p>Type: {asset.type}</p>
      </div>
    </>
  );
}

// ─── Video detail section ───

function VideoDetails({ video }: { video: Video }) {
  return (
    <>
      <Separator />

      <div className="space-y-1 text-sm text-muted-foreground">
        <p>
          Created{' '}
          {formatDistanceToNow(new Date(video.createdAt), { addSuffix: true })}
        </p>
        {video.durationMs && (
          <p>Duration: {Math.round(Number(video.durationMs) / 1000)}s</p>
        )}
        {video.creator?.name && <p>Created by: {video.creator.name}</p>}
      </div>
    </>
  );
}

// ─── Main dialog ───

export function ContentPreviewDialog({
  item,
  open,
  onOpenChange,
  onDelete,
  isDeleting,
}: ContentPreviewDialogProps) {
  const [postDialogOpen, setPostDialogOpen] = useState(false);

  // Fetch individual video to get presigned blobUrl (list endpoint nulls it out for perf)
  const { video: fullVideo } = useGetVideo(
    item?.kind === 'video' ? item.data.id : '',
    { enabled: open && item?.kind === 'video' && item.data.status === 'ready' }
  );

  if (!item) return null;

  const isAsset = item.kind === 'asset';
  const title = isAsset ? item.data.name : item.data.title || 'Untitled';
  const isVideo = isAsset ? item.data.type === 'video' : true; // AI-generated are always video
  // For AI-generated videos, prefer the individually-fetched video's blobUrl (presigned)
  const mediaUrl = isAsset
    ? item.data.blobUrl
    : (fullVideo?.blobUrl ?? item.data.blobUrl);
  const thumbnailUrl = !isAsset
    ? (fullVideo?.thumbnailUrl ?? item.data.thumbnailUrl)
    : null;
  const createdAt = isAsset ? item.data.createdAt : item.data.createdAt;
  const uploaderName = isAsset
    ? item.data.uploader?.name
    : item.data.creator?.name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isVideo ? (
              <VideoIcon className="size-5" />
            ) : (
              <ImageIcon className="size-5" />
            )}
            {title}
          </DialogTitle>
          <DialogDescription>
            {new Date(createdAt).toLocaleDateString()}
            {uploaderName && ` \u00B7 ${uploaderName}`}
            {!isAsset && (
              <Badge variant="secondary" className="ml-2">
                AI Generated
              </Badge>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Preview */}
          <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
            {isVideo ? (
              mediaUrl ? (
                // biome-ignore lint/a11y/useMediaCaption: User content
                <video
                  src={mediaUrl}
                  className="h-full w-full object-contain"
                  controls
                />
              ) : thumbnailUrl ? (
                <img
                  src={thumbnailUrl}
                  alt={title}
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <VideoIcon className="size-12 text-muted-foreground" />
                </div>
              )
            ) : (
              <img
                src={mediaUrl ?? ''}
                alt={title}
                className="absolute inset-0 size-full object-contain"
              />
            )}
          </div>

          {/* Type-specific details */}
          {isAsset ? (
            <AssetDetails asset={item.data as Asset} />
          ) : (
            <VideoDetails video={item.data as Video} />
          )}
        </div>

        <DialogFooter className="gap-2">
          {onDelete && (
            <Button
              variant="destructive"
              onClick={() => onDelete(item)}
              disabled={isDeleting}
            >
              <Trash2 className="size-4" />
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          )}
          {/* Download for ready AI videos */}
          {!isAsset && item.data.status === 'ready' && mediaUrl && (
            <Button
              variant="outline"
              onClick={() => window.open(mediaUrl, '_blank')}
            >
              <Download className="size-4" />
              Download
            </Button>
          )}
          {/* Post button for assets (they have blob URLs to post) */}
          {isAsset && (
            <Button onClick={() => setPostDialogOpen(true)}>
              <SendIcon className="size-4" />
              Post
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      {isAsset && (
        <PostContentDialog
          open={postDialogOpen}
          onOpenChange={setPostDialogOpen}
          asset={item.data as Asset}
          onSuccess={() => onOpenChange(false)}
        />
      )}
    </Dialog>
  );
}

export type { ContentItem };
