import { type Graphic, useListGraphics } from '@/features/graphics';
import { type Video, useListVideos } from '@/features/videos';
import { useMemo } from 'react';

import { graphicThumbUrl, readyGraphicOutputs } from './graphic-slide-carousel';

export interface GeneratedTile {
  key: string;
  createdAt: string;
  /** Thumbnail source. */
  type: 'image' | 'video';
  url: string | null;
  thumbnailUrl: string | null;
  alt: string;
  /** Number of slides for carousel graphics (>1 shows a badge). */
  slideCount: number;
}

function graphicToTile(graphic: Graphic): GeneratedTile {
  const slideCount = readyGraphicOutputs(graphic).length;
  return {
    key: `graphic-${graphic.id}`,
    createdAt: graphic.createdAt,
    type: 'image',
    // Grid tile uses the low-res thumbnail; the carousel/preview still gets
    // full-res slides from the graphic itself.
    url: graphicThumbUrl(graphic),
    thumbnailUrl: null,
    alt: graphic.title || 'Generated graphic',
    slideCount,
  };
}

function videoToTile(video: Video): GeneratedTile {
  return {
    key: `video-${video.id}`,
    createdAt: video.createdAt,
    type: 'video',
    url: video.blobUrl,
    thumbnailUrl: video.thumbnailUrl,
    alt: video.title || 'Generated video',
    slideCount: 0,
  };
}

/**
 * Loads the library of `ready` AI-generated graphics + videos and shapes them
 * into preview tiles, newest first. Shared by the desktop
 * {@link GeneratedContentCard} and the mobile generated-content section so both
 * stay in sync.
 */
export function useGeneratedContentTiles(): {
  tiles: GeneratedTile[];
  isLoading: boolean;
} {
  const { graphics, isLoading: isGraphicsLoading } = useListGraphics({
    status: 'ready',
    limit: 18,
  });
  const { videos, isLoading: isVideosLoading } = useListVideos({ limit: 24 });

  const tiles = useMemo(() => {
    const graphicTiles = graphics
      .map(graphicToTile)
      // A graphic marked ready with zero ready slides has nothing to show.
      .filter((t) => t.slideCount > 0);
    const videoTiles = videos
      .filter((v) => v.status === 'ready')
      .map(videoToTile);
    return [...graphicTiles, ...videoTiles].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }, [graphics, videos]);

  return { tiles, isLoading: isGraphicsLoading || isVideosLoading };
}
