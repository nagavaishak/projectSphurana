import { apiClient } from '@borradh-workspace/api-client';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Graphic } from '@/features/graphics';
import { useRegenerateGraphic } from '@/features/graphics/api/regenerate-graphic';

import { GraphicSlideCarousel } from './graphic-slide-carousel';

export interface GraphicProcessingModalProps {
  open: boolean;
  graphicId: string | null;
  onClose: () => void;
  /**
   * When provided, the ready state offers "Request changes" — the modal
   * re-rolls the graphic (pinning its template) and calls this with the new
   * graphic id so the parent repoints polling at it.
   */
  onRegenerated?: (newGraphicId: string) => void;
}

type ModalStatus = 'processing' | 'ready' | 'failed';

/**
 * Polls `GET /graphics/:id` every 2s while the social new-post async
 * pipeline renders a graphic in the background, then surfaces the result.
 *
 * Mirrors the video `ProcessingModal`. Polling stops once the graphic
 * row's `status` reaches `'ready'` or `'failed'`.
 */
export function GraphicProcessingModal({
  open,
  graphicId,
  onClose,
  onRegenerated,
}: GraphicProcessingModalProps) {
  const [showChange, setShowChange] = useState(false);
  const [changeRequest, setChangeRequest] = useState('');
  const [activeSlide, setActiveSlide] = useState(0);

  const { regenerateGraphicAsync, isRegenerating } = useRegenerateGraphic();

  const query = useQuery({
    queryKey: ['graphics', graphicId, 'poll'],
    queryFn: () => apiClient.get<Graphic>(`graphics/${graphicId}`),
    enabled: open && !!graphicId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'ready' || s === 'failed' ? false : 2000;
    },
    refetchOnWindowFocus: false,
    staleTime: 0,
  });

  const status: ModalStatus =
    query.data?.status === 'ready'
      ? 'ready'
      : query.data?.status === 'failed'
        ? 'failed'
        : 'processing';

  const canDismiss = status !== 'processing';
  const slideCount = query.data?.outputs?.length ?? 0;
  const isCarousel = slideCount > 1;

  const runRegenerate = async (scope: 'all' | 'slide') => {
    if (!graphicId) return;
    try {
      const next = await regenerateGraphicAsync({
        graphicId,
        refinementInstruction: changeRequest.trim() || undefined,
        scope,
        slideIndex: scope === 'slide' ? activeSlide : undefined,
      });
      setShowChange(false);
      setChangeRequest('');
      // Repoint the modal at the freshly-rendering graphic.
      onRegenerated?.(next.id);
    } catch {
      // toast surfaced by the hook
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && canDismiss) onClose();
      }}
    >
      <DialogContent
        className={status === 'ready' ? 'sm:max-w-lg' : 'sm:max-w-md'}
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
                <Loader2 className="size-5 animate-spin" />
                Generating your graphic…
              </DialogTitle>
              <DialogDescription>
                We&apos;re picking a template and rendering the slides. This
                usually takes 30–90 seconds.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-center py-8">
              <Loader2 className="size-10 animate-spin text-primary" />
            </div>
          </>
        )}

        {status === 'ready' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="size-5" />
                {query.data?.title ?? 'Your graphic is ready!'}
              </DialogTitle>
              <DialogDescription>
                Swipe through each slide. You can find this in your graphics
                library too.
              </DialogDescription>
            </DialogHeader>

            <GraphicSlideCarousel
              graphic={query.data ?? null}
              onIndexChange={setActiveSlide}
            />

            {showChange && onRegenerated ? (
              <div className="space-y-2">
                <Label htmlFor="graphic-change" className="text-sm">
                  What would you like to change?
                </Label>
                <Textarea
                  id="graphic-change"
                  value={changeRequest}
                  onChange={(e) => setChangeRequest(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="e.g. add a subtle blue tint, bigger logo, lead with the price…"
                  autoFocus
                />
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    variant="ghost"
                    onClick={() => setShowChange(false)}
                    disabled={isRegenerating}
                  >
                    Cancel
                  </Button>
                  {isCarousel && (
                    <Button
                      variant="outline"
                      onClick={() => void runRegenerate('slide')}
                      disabled={isRegenerating}
                      className="gap-2"
                    >
                      {isRegenerating ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                      Regenerate slide {activeSlide + 1}
                    </Button>
                  )}
                  <Button
                    onClick={() => void runRegenerate('all')}
                    disabled={isRegenerating}
                    className="gap-2"
                  >
                    {isRegenerating ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    {isCarousel ? 'Regenerate all slides' : 'Regenerate'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end gap-2">
                {onRegenerated && (
                  <Button
                    variant="outline"
                    onClick={() => setShowChange(true)}
                    className="gap-2"
                  >
                    <RefreshCw className="size-4" />
                    Request changes
                  </Button>
                )}
                <Button onClick={onClose} className="gap-2">
                  <CheckCircle2 className="size-4" />
                  Looks good
                </Button>
              </div>
            )}
          </>
        )}

        {status === 'failed' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <XCircle className="size-5" />
                Generation failed
              </DialogTitle>
              <DialogDescription>
                Something went wrong while generating your graphic. Please try
                again.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end py-2">
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
