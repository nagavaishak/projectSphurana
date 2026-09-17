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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Asset } from '@/features/assets';
import { format } from 'date-fns';
import {
  Calendar,
  Clock,
  Download,
  Layout,
  MoreVertical,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';

import { PostContentDialog } from './post-content-dialog';

interface PreviewContentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: Asset | null;
  onEdit?: (asset: Asset) => void;
  onDelete?: (asset: Asset) => void;
  onDownload?: (asset: Asset) => void;
  postsCount?: number;
  adsCount?: number;
}

function formatDuration(seconds: number | string | null): string {
  if (seconds == null) return 'Unknown';
  const numSeconds =
    typeof seconds === 'string' ? Number.parseFloat(seconds) : seconds;
  if (Number.isNaN(numSeconds)) return 'Unknown';
  const mins = Math.floor(numSeconds / 60);
  const secs = Math.floor(numSeconds % 60);
  return `${mins}m ${secs.toString().padStart(2, '0')}s`;
}

function formatCreatedAt(dateString: string): string {
  const date = new Date(dateString);
  return `${format(date, 'h:mma')} on ${format(date, 'EEEE, MMM d yyyy')}`;
}

export function PreviewContentDialog({
  open,
  onOpenChange,
  asset,
  onEdit,
  onDelete,
  onDownload,
  postsCount = 0,
  adsCount = 0,
}: PreviewContentDialogProps) {
  const [postDialogOpen, setPostDialogOpen] = useState(false);

  if (!asset) return null;

  const isVideo = asset.type === 'video';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle>Preview Content</DialogTitle>
          <DialogDescription>
            View details and post this content to your social media pages.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col sm:flex-row gap-6">
          <div className="flex-shrink-0 w-full sm:w-[280px]">
            {isVideo ? (
              // biome-ignore lint/a11y/useMediaCaption: User content preview
              <video
                src={asset.blobUrl}
                className="aspect-square w-full rounded-lg bg-black object-contain"
                controls
                playsInline
              />
            ) : (
              <div className="relative aspect-square w-full rounded-lg overflow-hidden bg-muted">
                <img
                  src={asset.blobUrl}
                  alt={asset.name}
                  className="absolute inset-0 size-full object-cover"
                />
              </div>
            )}
          </div>

          <div className="flex-1 space-y-6">
            <div className="flex gap-3">
              <Calendar className="size-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm">Created At</p>
                <p className="text-sm text-muted-foreground">
                  {formatCreatedAt(asset.createdAt)}
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <Clock className="size-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm">Length</p>
                <p className="text-sm text-muted-foreground">
                  {isVideo ? formatDuration(asset.duration) : 'N/A'}
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <Layout className="size-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm">Used in</p>
                <p className="text-sm text-muted-foreground">
                  {postsCount} post{postsCount !== 1 ? 's' : ''} and {adsCount}{' '}
                  ad{adsCount !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="sm:justify-end gap-2">
          <Button onClick={() => setPostDialogOpen(true)}>Post</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit?.(asset)}>
                <Pencil className="size-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDownload?.(asset)}>
                <Download className="size-4" />
                Download
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDelete?.(asset)}
                variant="destructive"
              >
                <Trash2 className="size-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </DialogFooter>
      </DialogContent>

      <PostContentDialog
        open={postDialogOpen}
        onOpenChange={setPostDialogOpen}
        asset={asset}
        onSuccess={() => onOpenChange(false)}
      />
    </Dialog>
  );
}
