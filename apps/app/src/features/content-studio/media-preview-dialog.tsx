import { Button } from '@/components/ui/button';
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { Asset } from '@/features/assets';
import type { Graphic, GraphicOutput } from '@/features/graphics';
import { type Video, useGetVideo } from '@/features/videos';
import {
  Download,
  Image as ImageIcon,
  Trash2,
  Video as VideoIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { AssetServiceCombobox } from './asset-service-combobox';

// ─── Unified media item: the three things the gallery can show ───

export type GalleryMediaItem =
  | { kind: 'asset'; data: Asset }
  | { kind: 'video'; data: Video }
  | { kind: 'graphic'; data: Graphic };

interface MediaPreviewDialogProps {
  item: GalleryMediaItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete?: (item: GalleryMediaItem) => void;
  isDeleting?: boolean;
}

function isVideoItem(item: GalleryMediaItem): boolean {
  return (
    item.kind === 'video' ||
    (item.kind === 'asset' && item.data.type === 'video')
  );
}

/**
 * A graphic's `outputs` array holds one rendered image per slide (carousel
 * support — see `GraphicOutput.slideOrder`). Returns the slides with a usable
 * URL, sorted by slide order so the carousel matches the editor.
 */
function graphicSlides(item: GalleryMediaItem): GraphicOutput[] {
  if (item.kind !== 'graphic') return [];
  return [...(item.data.outputs ?? [])]
    .filter((o) => o.url)
    .sort((a, b) => (a.slideOrder ?? 0) - (b.slideOrder ?? 0));
}

/**
 * One preview dialog shared across images, uploaded videos and AI-generated
 * graphics/videos. Shows the media large with delete/download actions.
 */
export function MediaPreviewDialog({
  item,
  open,
  onOpenChange,
  onDelete,
  isDeleting,
}: MediaPreviewDialogProps) {
  // AI-generated videos null out blobUrl in the list endpoint — fetch the
  // presigned URL individually when previewing one.
  const { video: fullVideo } = useGetVideo(
    item?.kind === 'video' ? item.data.id : '',
    { enabled: open && item?.kind === 'video' && item.data.status === 'ready' }
  );

  // Track the visible slide for multi-slide graphics so the counter and the
  // download button follow the carousel.
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();
  const [currentSlide, setCurrentSlide] = useState(0);

  // Reset to the first slide whenever a different item is previewed.
  const itemId = item?.data.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset keyed on item id
  useEffect(() => {
    setCurrentSlide(0);
  }, [itemId]);

  useEffect(() => {
    if (!carouselApi) return;
    setCurrentSlide(carouselApi.selectedScrollSnap());
    const onSelect = () => setCurrentSlide(carouselApi.selectedScrollSnap());
    carouselApi.on('select', onSelect);
    return () => {
      carouselApi.off('select', onSelect);
    };
  }, [carouselApi]);

  if (!item) return null;

  const isVideo = isVideoItem(item);
  const slides = graphicSlides(item);
  const isCarousel = slides.length > 1;

  let title = 'Untitled';
  let url: string | null = null;
  if (item.kind === 'asset') {
    title = item.data.name;
    url = item.data.blobUrl;
  } else if (item.kind === 'video') {
    title = item.data.title || 'Untitled';
    url = fullVideo?.blobUrl ?? item.data.blobUrl ?? item.data.thumbnailUrl;
  } else {
    title = item.data.title || 'Untitled';
    // Download follows the visible slide; falls back to the first.
    url = slides[currentSlide]?.url ?? slides[0]?.url ?? null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {/* Title kept for accessibility only — not shown. */}
        <DialogTitle className="sr-only">{title}</DialogTitle>

        {isCarousel ? (
          <div className="relative">
            <Carousel setApi={setCarouselApi} className="w-full">
              <CarouselContent>
                {slides.map((slide, index) => (
                  <CarouselItem key={slide.slideId ?? `${slide.url}-${index}`}>
                    <div className="flex max-h-[70vh] items-center justify-center overflow-hidden rounded-lg bg-muted">
                      <img
                        src={slide.url}
                        alt={`${title} — slide ${index + 1}`}
                        className="max-h-[70vh] w-auto object-contain"
                      />
                    </div>
                  </CarouselItem>
                ))}
              </CarouselContent>
              <CarouselPrevious className="left-2" />
              <CarouselNext className="right-2" />
            </Carousel>
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
              {currentSlide + 1} / {slides.length}
            </div>
          </div>
        ) : (
          <div className="flex max-h-[70vh] items-center justify-center overflow-hidden rounded-lg bg-muted">
            {url ? (
              isVideo ? (
                // biome-ignore lint/a11y/useMediaCaption: user-generated content
                <video
                  src={url}
                  controls
                  className="max-h-[70vh] w-auto object-contain"
                />
              ) : (
                <img
                  src={url}
                  alt={title}
                  className="max-h-[70vh] w-auto object-contain"
                />
              )
            ) : (
              <div className="flex aspect-video w-full items-center justify-center text-muted-foreground">
                {isVideo ? (
                  <VideoIcon className="size-12" />
                ) : (
                  <ImageIcon className="size-12" />
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex items-end justify-between gap-2">
          {/* Assign / change the service for uploaded assets. */}
          {item.kind === 'asset' ? (
            <AssetServiceCombobox
              assetId={item.data.id}
              currentServices={item.data.services ?? []}
            />
          ) : (
            <span />
          )}
          <div className="flex justify-end gap-2">
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
            {url && (
              <Button
                variant="outline"
                onClick={() => window.open(url, '_blank')}
              >
                <Download className="size-4" />
                Download{isCarousel ? ' slide' : ''}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
