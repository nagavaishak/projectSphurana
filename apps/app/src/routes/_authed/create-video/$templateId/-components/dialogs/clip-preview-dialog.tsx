import { VideoPlayer } from '@/components/kibo-ui/video-player';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CheckIcon, PlusIcon } from 'lucide-react';

interface ClipPreviewAsset {
  id: string;
  name: string;
  blobUrl: string;
  duration: number | string | null;
}

interface ClipPreviewDialogProps {
  asset: ClipPreviewAsset | null;
  isSelected: boolean;
  onToggleSelect: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function ClipPreviewDialog({
  asset,
  isSelected,
  onToggleSelect,
  open,
  onOpenChange,
}: ClipPreviewDialogProps) {
  if (!asset) return null;

  const duration =
    typeof asset.duration === 'string'
      ? Number(asset.duration)
      : asset.duration;

  const handleToggle = () => {
    onToggleSelect();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate">{asset.name}</DialogTitle>
        </DialogHeader>

        <VideoPlayer src={asset.blobUrl} />

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{asset.name}</span>
          <span>{formatDuration(duration)}</span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={handleToggle}
            variant={isSelected ? 'secondary' : 'default'}
          >
            {isSelected ? (
              <>
                <CheckIcon className="size-4" />
                Deselect
              </>
            ) : (
              <>
                <PlusIcon className="size-4" />
                Select
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
