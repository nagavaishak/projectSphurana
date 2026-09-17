import { ImageIcon, VideoIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useListAssets } from '@/features/assets';
import { useListGraphics } from '@/features/graphics';
import { useListVideos } from '@/features/videos';
import { cn } from '@/lib/utils';

/**
 * What the picker hands back. `videoId` carries either a rendered `video.id`
 * or an uploaded `asset.id` — the ad row's `videoId` column and the replace
 * endpoint both accept either, exactly as the ad wizard's media step passes
 * them (`select-video-step.tsx` sets `videoId` from all three sources).
 */
export interface PickedCreative {
  videoId?: string;
  graphicId?: string;
  /** Poster/still for the staged preview, so the panel can show the choice. */
  thumbnailUrl?: string;
  /** Playable source, when the pick is a video. */
  videoUrl?: string;
  label: string;
}

interface CreativePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (creative: PickedCreative) => void;
}

type MediaTab = 'videos' | 'images';

interface Tile {
  key: string;
  label: string;
  thumbnailUrl?: string;
  picked: PickedCreative;
}

function TileGrid({
  tiles,
  isLoading,
  emptyLabel,
  selectedKey,
  onSelect,
}: {
  tiles: Tile[];
  isLoading: boolean;
  emptyLabel: string;
  selectedKey: string | null;
  onSelect: (tile: Tile) => void;
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="aspect-square w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (tiles.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-3">
      {tiles.map((tile) => (
        <button
          key={tile.key}
          type="button"
          onClick={() => onSelect(tile)}
          aria-pressed={selectedKey === tile.key}
          className={cn(
            'group relative overflow-hidden rounded-md border bg-muted text-left transition',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            selectedKey === tile.key
              ? 'ring-2 ring-primary'
              : 'hover:border-foreground/30'
          )}
        >
          <div className="aspect-square w-full">
            {tile.thumbnailUrl ? (
              <img
                src={tile.thumbnailUrl}
                alt={tile.label}
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center text-muted-foreground">
                <ImageIcon className="size-6" />
              </div>
            )}
          </div>
          <span className="block truncate px-2 py-1.5 text-xs">
            {tile.label}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Pick a new creative for an ad from the org's own media.
 *
 * Read-only over three existing lists — it uploads nothing and renders
 * nothing new, so there is no way for it to leave a half-made asset behind.
 * Choosing here only STAGES the creative; the ad is not touched until the
 * panel's Save.
 */
export function CreativePickerDialog({
  open,
  onOpenChange,
  onPick,
}: CreativePickerDialogProps) {
  const [tab, setTab] = useState<MediaTab>('videos');
  const [selected, setSelected] = useState<Tile | null>(null);

  const { videos, isLoading: videosLoading } = useListVideos();
  const { assets: imageAssets, isLoading: imagesLoading } = useListAssets({
    type: 'image',
  });
  const { graphics, isLoading: graphicsLoading } = useListGraphics();

  // Only media that is actually renderable can become a creative: a video
  // still encoding has no playable source, and a graphic mid-render has no
  // output to point Meta at.
  const videoTiles: Tile[] = videos
    .filter((v) => v.status === 'ready')
    .map((v) => ({
      key: `video:${v.id}`,
      label: v.title ?? 'Untitled video',
      thumbnailUrl: v.thumbnailUrl ?? undefined,
      picked: {
        videoId: v.id,
        thumbnailUrl: v.thumbnailUrl ?? undefined,
        videoUrl: v.blobUrl ?? undefined,
        label: v.title ?? 'Untitled video',
      },
    }));

  const imageTiles: Tile[] = [
    ...imageAssets.map((a) => ({
      key: `asset:${a.id}`,
      label: a.name ?? 'Uploaded image',
      thumbnailUrl: a.thumbnailUrl ?? a.blobUrl ?? undefined,
      picked: {
        videoId: a.id,
        thumbnailUrl: a.thumbnailUrl ?? a.blobUrl ?? undefined,
        label: a.name ?? 'Uploaded image',
      },
    })),
    ...graphics
      .filter((g) => g.status === 'ready')
      .map((g) => {
        const url = g.outputs?.find((o) => o.status !== 'failed')?.url;
        return {
          key: `graphic:${g.id}`,
          label: g.title ?? 'Graphic',
          thumbnailUrl: url,
          picked: {
            graphicId: g.id,
            thumbnailUrl: url,
            label: g.title ?? 'Graphic',
          },
        };
      }),
  ];

  const handleConfirm = () => {
    if (!selected) return;
    onPick(selected.picked);
    setSelected(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose a new creative</DialogTitle>
          <DialogDescription>
            Pick from your videos and images. Nothing changes on the ad until
            you save.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as MediaTab)}>
          <TabsList>
            <TabsTrigger value="videos">
              <VideoIcon className="size-4" />
              Videos
            </TabsTrigger>
            <TabsTrigger value="images">
              <ImageIcon className="size-4" />
              Images
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="max-h-[45vh] overflow-y-auto">
          {tab === 'videos' ? (
            <TileGrid
              tiles={videoTiles}
              isLoading={videosLoading}
              emptyLabel="No finished videos yet."
              selectedKey={selected?.key ?? null}
              onSelect={setSelected}
            />
          ) : (
            <TileGrid
              tiles={imageTiles}
              isLoading={imagesLoading || graphicsLoading}
              emptyLabel="No images yet."
              selectedKey={selected?.key ?? null}
              onSelect={setSelected}
            />
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!selected}>
            Use this creative
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
