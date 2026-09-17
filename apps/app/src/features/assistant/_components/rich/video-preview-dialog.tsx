import { VideoPlayer } from '@/components/kibo-ui/video-player/video-player';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface VideoPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoUrl: string;
  thumbnailUrl?: string;
  title: string;
}

export function VideoPreviewDialog({
  open,
  onOpenChange,
  videoUrl,
  thumbnailUrl,
  title,
}: VideoPreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[100vw] p-0 overflow-hidden sm:max-w-2xl max-h-[100dvh] sm:max-h-[85vh]">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="px-6 pb-6">
          <VideoPlayer src={videoUrl} poster={thumbnailUrl} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
