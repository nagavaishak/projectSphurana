import { collectGraphicSlideUrls } from '@borradh-workspace/features/graphics/carousel-slides';
import type { GalleryMediaItem } from './media-preview-dialog';

/**
 * What `PostContentDialog` needs to publish a gallery tile.
 *
 * NOT an `Asset`. Both galleries used to hand the dialog an `as Asset` cast
 * over a hand-built object, which is how a carousel lost four of its five
 * slides on the way to Meta: `Asset` has one `blobUrl` and no way to say
 * "this is five images", so the cast quietly asserted that every graphic was
 * a single picture. The tile is the last place that still knows the truth —
 * this type is what carries it.
 */
export interface PostableMedia {
  /** The source row's id — the asset, video, or graphic. */
  id: string;
  name: string;
  type: 'image' | 'video';
  /** Slide 1 for a carousel; the only image/video otherwise. */
  blobUrl: string;
  /**
   * `null` as well as `undefined` so a plain `Asset` stays structurally
   * assignable — the preview dialogs post uploaded assets directly, and an
   * upload is already a valid `PostableMedia`: no slides, no source reference.
   */
  thumbnailUrl?: string | null;
  /**
   * Every slide, in order, when this is a carousel. ABSENT (never `[]`) for
   * single media — an empty array is the blank-vs-absent optional that has
   * broken requests here before.
   */
  mediaUrls?: string[];
  /** Set when the media is a generated graphic — lets the publisher re-resolve. */
  graphicId?: string;
  /** Set when the media is a generated video. */
  videoId?: string;
}

/**
 * Turn a gallery tile into something postable, or null when it has no usable
 * media yet (an AI video still rendering, a graphic whose slides all failed).
 *
 * Slide collection is delegated to `collectGraphicSlideUrls` — the same helper
 * the publisher and the content-batch accept flow use — rather than sorting
 * `outputs` here. That helper carries a guard this file must not re-derive:
 * a graphic with NO slide metadata is a single image exported at several
 * aspect ratios, and must never be mistaken for a multi-image carousel.
 */
export function toPostableMedia(item: GalleryMediaItem): PostableMedia | null {
  if (item.kind === 'asset') {
    const asset = item.data;
    if (!asset.blobUrl) return null;
    return {
      id: asset.id,
      name: asset.name,
      type: asset.type === 'video' ? 'video' : 'image',
      blobUrl: asset.blobUrl,
      thumbnailUrl: asset.thumbnailUrl ?? undefined,
    };
  }

  if (item.kind === 'graphic') {
    const slides = collectGraphicSlideUrls(item.data.outputs ?? []);
    const first = slides[0];
    if (!first) return null;
    return {
      id: item.data.id,
      name: item.data.title || 'Graphic',
      type: 'image',
      blobUrl: first,
      // Only a real carousel carries the list; a single graphic omits it.
      ...(slides.length > 1 ? { mediaUrls: slides } : {}),
      graphicId: item.data.id,
    };
  }

  const url = item.data.blobUrl;
  if (!url) return null;
  return {
    id: item.data.id,
    name: item.data.title || 'Video',
    type: 'video',
    blobUrl: url,
    thumbnailUrl: item.data.thumbnailUrl ?? undefined,
    videoId: item.data.id,
  };
}
