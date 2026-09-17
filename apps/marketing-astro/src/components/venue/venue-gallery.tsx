import { cn } from '@/lib/utils';
import type { OrganizationPhotoResponse } from '@borradh-workspace/contracts';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ImageIcon,
  XIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

interface VenueGalleryProps {
  photos: OrganizationPhotoResponse[];
  venueName: string;
}

/**
 * The hero gallery: one large lead image, two stacked to its right, and a
 * "See all images" affordance. Opening it shows a full-page image gallery, and
 * clicking any photo there opens a full-screen viewer with prev/next paging.
 * Falls back to a placeholder when the venue has no photos yet.
 */
export function VenueGallery({ photos, venueName }: VenueGalleryProps) {
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const closeViewer = useCallback(() => setViewerIndex(null), []);
  const showPrev = useCallback(() => {
    setViewerIndex((i) =>
      i === null ? i : (i - 1 + photos.length) % photos.length
    );
  }, [photos.length]);
  const showNext = useCallback(() => {
    setViewerIndex((i) => (i === null ? i : (i + 1) % photos.length));
  }, [photos.length]);

  // Escape closes the top-most layer; arrows page the viewer. Lock body scroll
  // while any overlay is open.
  const anyOpen = galleryOpen || viewerIndex !== null;
  useEffect(() => {
    if (!anyOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (viewerIndex !== null) closeViewer();
        else setGalleryOpen(false);
      } else if (viewerIndex !== null && e.key === 'ArrowLeft') {
        showPrev();
      } else if (viewerIndex !== null && e.key === 'ArrowRight') {
        showNext();
      }
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [anyOpen, viewerIndex, closeViewer, showPrev, showNext]);

  if (photos.length === 0) {
    return (
      <div className="flex aspect-[2/1] w-full items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <ImageIcon className="size-10" />
      </div>
    );
  }

  const [lead, second, third] = photos;

  return (
    <>
      <div className="grid grid-cols-1 gap-2 sm:h-[480px] sm:grid-cols-3 sm:grid-rows-2">
        <button
          type="button"
          onClick={() => setGalleryOpen(true)}
          className="relative aspect-[3/2] overflow-hidden rounded-2xl sm:col-span-2 sm:row-span-2 sm:aspect-auto sm:h-full"
        >
          <img
            src={lead.url}
            alt={lead.caption ?? `${venueName} photo`}
            className="h-full w-full object-cover"
          />
        </button>

        {second && (
          <button
            type="button"
            onClick={() => setGalleryOpen(true)}
            className="relative hidden overflow-hidden rounded-2xl sm:block sm:h-full"
          >
            <img
              src={second.url}
              alt={second.caption ?? `${venueName} photo`}
              className="h-full w-full object-cover"
            />
          </button>
        )}

        {third && (
          <button
            type="button"
            onClick={() => setGalleryOpen(true)}
            className="relative hidden overflow-hidden rounded-2xl sm:block sm:h-full"
          >
            <img
              src={third.url}
              alt={third.caption ?? `${venueName} photo`}
              className="h-full w-full object-cover"
            />
            <span className="absolute right-3 bottom-3 rounded-full bg-background px-4 py-2 font-medium text-sm shadow">
              See all images
            </span>
          </button>
        )}
      </div>

      {/* Full-page image gallery */}
      {galleryOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
          <button
            type="button"
            onClick={() => setGalleryOpen(false)}
            aria-label="Close gallery"
            className="fixed top-4 right-4 z-10 flex size-11 items-center justify-center rounded-full border bg-background text-foreground shadow-sm transition hover:bg-muted sm:top-6 sm:right-6"
          >
            <XIcon className="size-5" />
          </button>

          <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
            <header className="space-y-1">
              <h2 className="font-bold text-4xl">Image gallery</h2>
              <p className="text-muted-foreground">{venueName}</p>
            </header>

            <div className="mt-8 grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              {photos.map((photo, i) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => setViewerIndex(i)}
                  className={cn(i === 0 && 'sm:col-span-2')}
                >
                  <img
                    src={photo.url}
                    alt={photo.caption ?? `${venueName} photo`}
                    className="h-auto w-full rounded-2xl"
                  />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Full-screen single-image viewer */}
      {viewerIndex !== null && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black">
          <div className="relative flex items-center justify-center px-4 py-4 text-white">
            <span className="absolute left-4 font-medium sm:left-6">Venue</span>
            <span className="text-sm text-white/80">
              {viewerIndex + 1}/{photos.length}
            </span>
            <button
              type="button"
              onClick={closeViewer}
              aria-label="Close viewer"
              className="absolute right-4 flex size-11 items-center justify-center rounded-full border border-white/30 text-white transition hover:bg-white/10 sm:right-6"
            >
              <XIcon className="size-5" />
            </button>
          </div>

          <div className="relative flex flex-1 items-center justify-center overflow-hidden px-4 pb-6 sm:px-16">
            {photos.length > 1 && (
              <button
                type="button"
                onClick={showPrev}
                aria-label="Previous image"
                className="absolute left-3 flex size-11 items-center justify-center rounded-full border border-white/30 text-white transition hover:bg-white/10 sm:left-6"
              >
                <ChevronLeftIcon className="size-6" />
              </button>
            )}

            <img
              src={photos[viewerIndex].url}
              alt={photos[viewerIndex].caption ?? `${venueName} photo`}
              className="max-h-full max-w-full rounded-lg object-contain"
            />

            {photos.length > 1 && (
              <button
                type="button"
                onClick={showNext}
                aria-label="Next image"
                className="absolute right-3 flex size-11 items-center justify-center rounded-full border border-white/30 text-white transition hover:bg-white/10 sm:right-6"
              >
                <ChevronRightIcon className="size-6" />
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
