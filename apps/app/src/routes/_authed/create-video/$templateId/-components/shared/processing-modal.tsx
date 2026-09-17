import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import type {
  Video,
  VideoProcessingStage,
  VideoStatus,
} from '@/features/videos';
import { videoProcessingStageLabels } from '@/features/videos';
import { apiClient } from '@borradh-workspace/api-client';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface ProcessingModalProps {
  open: boolean;
  onClose: () => void;
  videoId: string | null;
  onVideoReady: () => void;
  readyActionLabel?: string;
  /** When true, navigates via `onVideoReady` shortly after the video reaches ready. */
  autoContinueOnReady?: boolean;
  /**
   * Re-roll the video with a free-text change request. When provided, the
   * ready state offers a "Request changes" action. The parent owns the
   * regeneration (it rebuilds the draft + re-queues the export) and bumps
   * `regenTick` so this modal resumes polling the same video.
   */
  onRegenerate?: (changeRequest: string) => void;
  /** True while a regeneration request is in flight. */
  isRegenerating?: boolean;
  /** Bumped by the parent after a regenerate is queued, to restart polling. */
  regenTick?: number;
}

type ModalStatus = 'processing' | 'ready' | 'failed';

export function ProcessingModal({
  open,
  onClose,
  videoId,
  onVideoReady,
  readyActionLabel = 'View in Library',
  autoContinueOnReady = false,
  onRegenerate,
  isRegenerating,
  regenTick = 0,
}: ProcessingModalProps) {
  const [status, setStatus] = useState<ModalStatus>('processing');
  const [showChange, setShowChange] = useState(false);
  const [changeRequest, setChangeRequest] = useState('');
  const hasAutoContinuedRef = useRef(false);
  const [progress, setProgress] = useState(0);
  const [processingStage, setProcessingStage] =
    useState<VideoProcessingStage | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Map video status to modal status
  const mapStatus = useCallback((videoStatus: VideoStatus): ModalStatus => {
    switch (videoStatus) {
      case 'ready':
        return 'ready';
      case 'failed':
        return 'failed';
      default:
        return 'processing';
    }
  }, []);

  // Poll the API for video status
  // biome-ignore lint/correctness/useExhaustiveDependencies: regenTick is an intentional re-poll trigger after a regenerate (same videoId)
  useEffect(() => {
    if (!open || !videoId) return;

    // Reset state when opening
    setStatus('processing');
    setProgress(0);
    setProcessingStage(null);
    setDownloadUrl(null);
    setThumbnailUrl(null);
    setErrorMessage(null);

    const pollStatus = async () => {
      try {
        const video = await apiClient.get<Video>(`videos/${videoId}`);

        const newStatus = mapStatus(video.status);
        setStatus(newStatus);
        setProgress(Number(video.progress) || 0);
        setProcessingStage(
          (video.processingStage as VideoProcessingStage | null) ?? null
        );

        if (video.status === 'ready') {
          if (video.blobUrl) {
            setDownloadUrl(video.blobUrl);
          }
          if (video.thumbnailUrl) {
            setThumbnailUrl(video.thumbnailUrl);
          }
        }

        if (video.status === 'failed') {
          setErrorMessage(video.errorMessage ?? 'An unknown error occurred');
        }

        // Stop polling if video is ready or failed
        return video.status === 'ready' || video.status === 'failed';
      } catch (error) {
        console.error('Failed to get video status:', error);
        return false;
      }
    };

    // Initial poll
    pollStatus();

    // Set up polling interval
    const interval = setInterval(async () => {
      const shouldStop = await pollStatus();
      if (shouldStop) {
        clearInterval(interval);
      }
    }, 2000);

    return () => clearInterval(interval);
    // regenTick is included so a regenerate (same videoId) restarts polling.
  }, [open, videoId, mapStatus, regenTick]);

  useEffect(() => {
    if (!open) {
      hasAutoContinuedRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (
      !open ||
      !autoContinueOnReady ||
      status !== 'ready' ||
      hasAutoContinuedRef.current
    ) {
      return;
    }
    hasAutoContinuedRef.current = true;
    const timer = window.setTimeout(() => {
      onVideoReady();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [open, autoContinueOnReady, status, onVideoReady]);

  const handleDownload = () => {
    if (downloadUrl) {
      window.open(downloadUrl, '_blank');
    }
  };

  // Only allow dismissing (X / Escape / click outside) when failed
  // When ready, user must use "View in Library" or "Download" buttons
  const canDismiss = status === 'failed';

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && canDismiss) {
          onClose();
        }
      }}
    >
      <DialogContent
        className="!w-[min(20rem,calc(100vw-2rem))] !max-w-[min(20rem,calc(100vw-2rem))] h-auto !max-h-[min(36rem,85dvh)] gap-3 overflow-y-auto p-5 sm:!w-auto sm:!max-w-lg sm:p-6"
        onPointerDownOutside={(e) => {
          if (!canDismiss) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (!canDismiss) e.preventDefault();
        }}
        showCloseButton={canDismiss}
      >
        {status === 'processing' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                Processing your video...
              </DialogTitle>
              <DialogDescription>
                This usually takes 1-2 minutes. Please wait while we process
                your video.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <Progress value={Math.min(progress, 100)} className="h-2" />
              <p className="text-sm text-muted-foreground text-center">
                {processingStage
                  ? videoProcessingStageLabels[processingStage]
                  : 'Starting'}
                {' \u2014 '}
                {Math.round(Math.min(progress, 100))}%
              </p>
            </div>
          </>
        )}

        {status === 'ready' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="h-5 w-5" />
                Your video is ready!
              </DialogTitle>
              <DialogDescription>
                {autoContinueOnReady
                  ? 'Your video is ready. Taking you to your ad…'
                  : 'Your video has been processed successfully and is ready to download or view in your content library.'}
              </DialogDescription>
            </DialogHeader>

            <div className="py-4">
              {/* The dialog is capped at 36rem tall, so the player has to fit
                  what the header, actions, padding and gaps leave it — and that
                  budget differs by breakpoint: below `sm` the actions stack into
                  a ~7.75rem column instead of a single 2.25rem row, leaving far
                  less room. Hence the smaller cap on mobile. A purely
                  dvh-relative height would outgrow the fixed 36rem cap on tall
                  viewports and scroll the dialog, so both caps are absolute. */}
              <div className="mx-auto flex aspect-[9/16] max-h-[min(30dvh,13rem)] items-center justify-center overflow-hidden rounded-lg bg-muted sm:max-h-[min(42dvh,21rem)]">
                {downloadUrl ? (
                  // The point of this state is to watch the render, so give it
                  // real controls rather than a still. The poster keeps the
                  // first frame visible before the file loads.
                  // biome-ignore lint/a11y/useMediaCaption: generated video has no caption track today
                  <video
                    src={downloadUrl}
                    poster={thumbnailUrl ?? undefined}
                    className="h-full w-full object-contain"
                    controls
                    playsInline
                    preload="metadata"
                  />
                ) : thumbnailUrl ? (
                  <img
                    src={thumbnailUrl}
                    alt="Video thumbnail"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-sm text-muted-foreground">
                    Preview unavailable
                  </span>
                )}
              </div>
            </div>

            {showChange && onRegenerate ? (
              <div className="space-y-2">
                <Label htmlFor="video-change" className="text-sm">
                  What would you like to change?
                </Label>
                <Textarea
                  id="video-change"
                  value={changeRequest}
                  onChange={(e) => setChangeRequest(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="e.g. punchier hook, friendlier tone, mention our free consultation…"
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setShowChange(false)}
                    disabled={isRegenerating}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      onRegenerate(changeRequest);
                      setShowChange(false);
                      setChangeRequest('');
                    }}
                    disabled={isRegenerating}
                  >
                    {isRegenerating ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Regenerate
                  </Button>
                </div>
              </div>
            ) : (
              // Three actions, one with a caller-supplied label
              // (`readyActionLabel`) — so wrap rather than assuming they fit on
              // one line at any given dialog width.
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
                {onRegenerate && (
                  <Button
                    variant="outline"
                    className="w-full sm:w-auto"
                    onClick={() => setShowChange(true)}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Request changes
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={handleDownload}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download MP4
                </Button>
                <Button className="w-full sm:w-auto" onClick={onVideoReady}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  {readyActionLabel}
                </Button>
              </div>
            )}
          </>
        )}

        {status === 'failed' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <XCircle className="h-5 w-5" />
                Processing Failed
              </DialogTitle>
              <DialogDescription>
                {errorMessage ||
                  'Something went wrong while processing your video. Please try again.'}
              </DialogDescription>
            </DialogHeader>

            <div className="flex justify-center py-4">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
