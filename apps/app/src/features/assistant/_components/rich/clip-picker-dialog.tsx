import { Button } from '@/components/ui/button';
import { useListAssets } from '@/features/assets/api/list-assets';
import { useListAssetsByService } from '@/features/assets/api/list-assets-by-service';
import {
  mintStockClips,
  useListStockClips,
} from '@/features/socials/api/stock-clips';
import { VideoThumbnail } from '@/routes/_authed/create-video/$templateId/-components/shared/video-thumbnail';
import {
  type AssetContentTypeTag,
  assetContentTypeTagLabels,
} from '@borradh-workspace/api-client/types';
import { Check, VideoIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  buildClipPickerLibrary,
  filterClipPickerLibrary,
} from './clip-picker-library';
import { ContentSelector } from './content-selector';

interface ClipPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Currently selected clip asset IDs. Local edits revert on Cancel. */
  selectedIds: string[];
  /** Called with the new selection when the user clicks Done. */
  onConfirm: (ids: string[]) => void;
  /**
   * When set, clips linked to this service sort to the top of every filter
   * and are visually flagged. Other clips still appear below.
   */
  serviceId?: string | null;
  /** Minimum clips required to render. Done is disabled below this. */
  minCount?: number;
}

// `stock` is not an asset tag — it is a different SOURCE, so it sits beside
// the tag filters rather than among them.
type TabKey = 'all' | 'stock' | AssetContentTypeTag;

// Keep the filter in sync with the complete asset tagging model. "All" lives
// at the head; the rest follow the label declaration order.
const TAG_FILTERS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'All' },
  ...(
    Object.entries(assetContentTypeTagLabels) as [AssetContentTypeTag, string][]
  ).map(([key, label]) => ({ key: key as TabKey, label })),
];

function formatDuration(seconds: number | string | null | undefined): string {
  if (seconds === null || seconds === undefined) return '--:--';
  const num = typeof seconds === 'string' ? Number(seconds) : seconds;
  if (Number.isNaN(num) || num <= 0) return '--:--';
  const mins = Math.floor(num / 60);
  const secs = Math.floor(num % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** Stock tiles mounted per page — one screenful on a typical dialog width. */
const STOCK_PAGE_SIZE = 8;

export function ClipPickerDialog({
  open,
  onOpenChange,
  selectedIds,
  onConfirm,
  serviceId,
  minCount = 1,
}: ClipPickerDialogProps) {
  const [localSelected, setLocalSelected] = useState<string[]>(selectedIds);
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [search, setSearch] = useState('');

  // What was already in the video when this dialog opened.
  //
  // Ordering keys on THIS, not on the live selection. Sorting by the live one
  // makes a tile jump to the top of the grid the instant you select it — and
  // then jump back when you change your mind — so the thing under the cursor
  // is never the thing you clicked. Frozen at open, the clips already in the
  // video lead, and everything stays where you found it for the rest of the
  // sitting.
  const [openedWith, setOpenedWith] = useState<string[]>(selectedIds);

  useEffect(() => {
    if (open) {
      setLocalSelected(selectedIds);
      setOpenedWith(selectedIds);
      setStockVisible(STOCK_PAGE_SIZE);
    }
  }, [open, selectedIds]);

  const { assets: allVideoAssets, isLoading: loadingAll } = useListAssets({
    type: 'video',
    source: 'raw',
    limit: 100,
  });
  const { assets: serviceAssets, isLoading: loadingService } =
    useListAssetsByService(serviceId ?? '');
  // The curated bank.
  //
  // The picker used to show uploaded footage ONLY, so an org with nothing
  // uploaded opened it to "Upload videos in Content to populate this library" —
  // while the renderer was already building their videos from these very clips.
  // Selecting one mints an org-owned asset on confirm, so browsing stays free.
  const { stockClips, isLoading: loadingStock } = useListStockClips({
    serviceId: serviceId ?? null,
  });
  const [isMinting, setIsMinting] = useState(false);
  // Stock is chosen by `stockClipId`; uploads by `assetId`. Kept apart until
  // confirm, because a stock clip HAS no asset id until it is minted.
  const [selectedStockIds, setSelectedStockIds] = useState<string[]>([]);
  // How many stock tiles are MOUNTED.
  //
  // Every tile is a `<video>` that range-requests its own header and first
  // frame, so rendering the full page at once fires ~24 parallel media
  // requests and the grid crawls in. Mounting a screenful and growing on
  // demand keeps the first paint quick; the data itself is already cached, so
  // "Show more" costs nothing but the media.
  const [stockVisible, setStockVisible] = useState(STOCK_PAGE_SIZE);

  const isLoading =
    loadingAll || (serviceId ? loadingService : false) || loadingStock;

  // The general query is constrained to raw uploads (generated videos live
  // under the separate videos API). The helper applies the same source guard
  // to service results, keeps their confidence order, and de-duplicates them.
  const { ordered, serviceLinked } = useMemo(
    () => buildClipPickerLibrary(allVideoAssets, serviceAssets),
    [allVideoAssets, serviceAssets]
  );

  // Category + search filter on top of the service-sorted order, with the
  // clips already in the video lifted to the front — they are the ones being
  // edited, and hunting for them in a grid of a hundred is the work this is
  // meant to save.
  const visibleAssets = useMemo(() => {
    const filtered = filterClipPickerLibrary(ordered, activeTab, search);
    const inVideo = new Set(openedWith);
    return [
      ...filtered.filter((a) => inVideo.has(a.id)),
      ...filtered.filter((a) => !inVideo.has(a.id)),
    ];
  }, [ordered, activeTab, search, openedWith]);

  const handleToggle = (id: string) => {
    setLocalSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleConfirm = async () => {
    if (selectedStockIds.length === 0) {
      onConfirm(localSelected);
      onOpenChange(false);
      return;
    }

    // Mint ONLY what was actually picked — browsing the bank must not litter
    // the library with assets nobody chose.
    //
    // Everything after the await is inside the try. A rejection used to escape
    // this handler entirely: the dialog stayed open, nothing was reported, and
    // the button simply appeared dead. A failure the operator cannot see is
    // worse than the failure itself.
    setIsMinting(true);
    try {
      const assetIds = await mintStockClips(selectedStockIds);
      const minted = selectedStockIds
        .map((id) => assetIds[id])
        .filter((id): id is string => Boolean(id));

      if (minted.length === 0) {
        toast.error('Those clips could not be added. Please try again.');
        return;
      }
      if (minted.length < selectedStockIds.length) {
        toast.warning(
          `Added ${minted.length} of ${selectedStockIds.length} clips.`
        );
      }

      onConfirm([...localSelected, ...minted]);
      onOpenChange(false);
    } catch (error) {
      // Stay OPEN on failure — the selection is still on screen and a retry
      // costs one click, where a closed dialog would lose it silently.
      toast.error(
        error instanceof Error ? error.message : 'Failed to add those clips'
      );
    } finally {
      setIsMinting(false);
    }
  };

  const handleCancel = () => {
    setLocalSelected(selectedIds);
    setSelectedStockIds([]);
    onOpenChange(false);
  };

  /**
   * A stock tile is selected either because it was picked in THIS sitting
   * (pending a mint) or because the org already minted it and that asset is in
   * the current selection.
   *
   * Both cases have to count, or a video built from stock opens this dialog
   * with nothing highlighted over the very clips it is made of — the grid keys
   * on `stockClipId`, and the list it is handed contains asset ids.
   */
  const isStockSelected = (clip: {
    stockClipId: string;
    mintedAssetId: string | null;
  }) =>
    selectedStockIds.includes(clip.stockClipId) ||
    (clip.mintedAssetId !== null && localSelected.includes(clip.mintedAssetId));

  const toggleStock = (clip: {
    stockClipId: string;
    mintedAssetId: string | null;
  }) => {
    // Already minted: this is an ordinary asset selection. Routing it through
    // `selectedStockIds` would mint a SECOND copy of a clip the org owns.
    if (clip.mintedAssetId) {
      const assetId = clip.mintedAssetId;
      setLocalSelected((prev) =>
        prev.includes(assetId)
          ? prev.filter((x) => x !== assetId)
          : [...prev, assetId]
      );
      return;
    }
    setSelectedStockIds((prev) =>
      prev.includes(clip.stockClipId)
        ? prev.filter((x) => x !== clip.stockClipId)
        : [...prev, clip.stockClipId]
    );
  };

  // Both sources count towards the minimum — the point of the bank is that an
  // org with no uploads can still fill a video.
  const matchingStockClips = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = q
      ? stockClips.filter((clip) =>
          (clip.description ?? '').toLowerCase().includes(q)
        )
      : stockClips;
    // Same rule as the uploads grid. It matters more here: the stock bank runs
    // to hundreds of clips behind a "Show more", so a clip already in the video
    // could sit several pages down and read as missing.
    const inVideo = new Set(openedWith);
    return [
      ...matched.filter(
        (c) => c.mintedAssetId !== null && inVideo.has(c.mintedAssetId)
      ),
      ...matched.filter(
        (c) => c.mintedAssetId === null || !inVideo.has(c.mintedAssetId)
      ),
    ];
  }, [stockClips, search, openedWith]);
  const visibleStockClips = matchingStockClips.slice(0, stockVisible);

  const belowMin = localSelected.length + selectedStockIds.length < minCount;

  // The stock bank is a SOURCE, not a tag, so it joins the filter list as its
  // own entry rather than a slot among the tags.
  const filters = [
    ...TAG_FILTERS,
    ...(stockClips.length > 0
      ? [
          {
            key: 'stock' as TabKey,
            label: `Stock library (${stockClips.length})`,
          },
        ]
      : []),
  ];

  return (
    <ContentSelector
      open={open}
      onOpenChange={(next) => {
        setLocalSelected(selectedIds);
        onOpenChange(next);
      }}
      title="Choose videos"
      search={search}
      onSearchChange={(value) => {
        setSearch(value);
        // A new query is a new list — keep paging from the top rather than
        // showing three results out of a page size of eight.
        setStockVisible(STOCK_PAGE_SIZE);
      }}
      filters={filters}
      filter={activeTab}
      onFilterChange={setActiveTab}
      filterLabel="Filter videos"
      skeletonClassName="aspect-video w-full"
      isLoading={isLoading}
      // Never "empty": the grid below renders uploads AND the stock bank, and
      // each says for itself when it has nothing. Hiding the bank behind an
      // empty state made the picker look bare for any org with no uploads —
      // which is most of them, and exactly the case the bank exists to serve.
      isEmpty={false}
      empty={null}
      footerNote={
        <>
          <span className="font-medium text-foreground">
            {localSelected.length}
          </span>{' '}
          selected{minCount > 0 ? ` · minimum ${minCount}` : ''}
        </>
      }
      confirmLabel={isMinting ? 'Adding clips…' : 'Use selected clips'}
      // Confirming a stock pick MINTS it, which is a round trip — without this
      // the dialog closes on a double-press and the second mint lands after
      // `onConfirm` has already run.
      confirmDisabled={belowMin || isMinting}
      confirmTitle={
        belowMin
          ? `Select at least ${minCount} clip${minCount === 1 ? '' : 's'}`
          : undefined
      }
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    >
      <>
        {/* Shown in the DEFAULT view as well as its own filter.
              Hiding the bank behind a dropdown made the picker look empty for
              any org with no uploads — which is most of them, and exactly the
              case the bank exists to serve. Uploads come first when there are
              any; stock fills the rest. */}
        {!isLoading &&
          (activeTab === 'stock' || activeTab === 'all') &&
          stockClips.length > 0 && (
            <>
              {activeTab === 'all' && visibleAssets.length > 0 ? (
                <p className="mb-2 mt-4 text-xs font-medium text-muted-foreground">
                  Stock library
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {visibleStockClips.map((clip) => {
                  const isSelected = isStockSelected(clip);
                  return (
                    <button
                      key={clip.stockClipId}
                      type="button"
                      onClick={() => toggleStock(clip)}
                      aria-pressed={isSelected}
                      aria-label={`${isSelected ? 'Deselect' : 'Select'} ${clip.description ?? 'stock clip'}`}
                      className={`group relative overflow-hidden rounded-lg border-2 text-left transition-colors ${
                        isSelected
                          ? 'border-primary'
                          : 'border-transparent hover:border-muted-foreground/30'
                      }`}
                    >
                      {/* `preload="metadata"` + a `#t=0.1` seek paints the
                          first frame in Chrome and NOTHING in Safari, where the
                          whole stock grid came up as grey boxes. Safari will
                          not paint from preload/seek alone — see
                          `VideoThumbnail`, which owns the one approach that
                          works everywhere (autoPlay + muted, paused on the
                          first play event) and now carries the hover preview
                          too, so this tile keeps it without keeping the bug. */}
                      <VideoThumbnail
                        src={clip.previewUrl}
                        playOnHover
                        className="aspect-video w-full bg-muted"
                      />
                      <span className="block truncate px-2 py-1.5 text-xs">
                        {clip.description ?? 'Stock clip'}
                      </span>
                      {isSelected ? (
                        <span className="absolute right-1.5 top-1.5 rounded-full bg-primary p-1 text-primary-foreground">
                          <Check className="size-3" />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {matchingStockClips.length > visibleStockClips.length ? (
                <div className="mt-3 flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setStockVisible((n) => n + STOCK_PAGE_SIZE)}
                  >
                    Show more (
                    {matchingStockClips.length - visibleStockClips.length} left)
                  </Button>
                </div>
              ) : null}
            </>
          )}

        {!isLoading &&
          activeTab !== 'stock' &&
          visibleAssets.length === 0 &&
          stockClips.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground">
              <VideoIcon className="mb-3 size-8 opacity-40" />
              <p>No clips match this filter.</p>
              {search ? (
                <p className="text-xs">Try clearing the search.</p>
              ) : activeTab !== 'all' ? (
                <p className="text-xs">Try a different category.</p>
              ) : (
                <p className="text-xs">
                  {stockClips.length > 0
                    ? 'Nothing uploaded yet — pick from the stock library instead.'
                    : 'Upload videos in Content to populate this library.'}
                </p>
              )}
            </div>
          )}

        {!isLoading && activeTab !== 'stock' && visibleAssets.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {visibleAssets.map((asset) => {
              const isSelected = localSelected.includes(asset.id);
              return (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => handleToggle(asset.id)}
                  aria-pressed={isSelected}
                  aria-label={`${isSelected ? 'Deselect' : 'Select'} ${asset.name}`}
                  className={`group relative text-left rounded-lg overflow-hidden border-2 transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-transparent hover:border-muted-foreground/20'
                  }`}
                >
                  <div className="aspect-video bg-muted relative">
                    {asset.thumbnailUrl ? (
                      <img
                        src={asset.thumbnailUrl}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : asset.blobUrl ? (
                      <VideoThumbnail
                        src={asset.blobUrl}
                        className="w-full h-full"
                        isImage={asset.type === 'image'}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <VideoIcon className="size-8 text-muted-foreground/40" />
                      </div>
                    )}
                    <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                      {formatDuration(asset.duration)}
                    </span>
                    <div className="absolute top-1.5 left-1.5">
                      <span
                        className={`grid size-5 place-items-center rounded border shadow-sm ${
                          isSelected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-white/80 bg-white text-transparent'
                        }`}
                        aria-hidden="true"
                      >
                        <Check className="size-3.5" />
                      </span>
                    </div>
                    {serviceLinked.has(asset.id) && (
                      <span className="absolute top-1.5 right-1.5 rounded bg-primary/90 px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                        Service match
                      </span>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-xs font-medium truncate">{asset.name}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </>
    </ContentSelector>
  );
}
