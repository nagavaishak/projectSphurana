import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useListAssets } from '@/features/assets/api/list-assets';
import { useListAssetsByService } from '@/features/assets/api/list-assets-by-service';
import { useGenerateGraphic } from '@/features/graphics/api/generate-graphic';
import { apiClient } from '@borradh-workspace/api-client';
import type {
  Graphic,
  GraphicCategory,
} from '@borradh-workspace/api-client/types';
import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query-keys';
import { Check, ImageIcon, Loader2, Pencil, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GraphicStatusCard } from './graphic-status-card';
import { ImagePickerDialog } from './image-picker-dialog';
import {
  describeImageryOrder,
  getDefaultServiceImageIds,
} from './image-picker-library';

interface GraphicDraftPreviewProps {
  /**
   * The item this proposal was opened under.
   *
   * A graphic does not exist until Accept, so unlike the video card there is no
   * cut to stamp this with — the item is opened up front precisely so there is.
   * Its attempt 0 carries a null asset until Accept fills it, and that null is
   * how this card knows whether it has already been acted on.
   *
   * Absent on older transcripts, which keep the previous browser-local
   * behaviour rather than being retired on a guess.
   */
  itemId?: string;
  /**
   * The attempt this proposal opened. The card reads ITS asset, not the item's
   * current one — a later edit moves the item on, and reading "current" made
   * an earlier draft card point at a graphic a later turn produced, so two rows
   * showed the same carousel.
   */
  attemptId?: string;
  serviceId: string;
  title?: string;
  category: string;
  kind?: string;
  topicSummary?: string;
  fields?: Array<{ label: string; value: string }>;
}

export function GraphicDraftPreviewCard({
  itemId,
  attemptId,
  serviceId,
  title = 'Graphic draft',
  category,
  kind,
  topicSummary,
  fields = [],
}: GraphicDraftPreviewProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  /**
   * Permission to INVENT imagery, and nothing more.
   *
   * OFF by default, which is the behaviour this card has always had — it used
   * to send `allowAiImages: false` as a literal, so an org whose service has no
   * uploads fell through to the curated library with no way to ask for
   * anything else.
   *
   * It never competes with a chosen photograph: every imagery policy tries the
   * org's own linked assets FIRST. This only decides what happens once the real
   * tiers come back empty — invent a fitting image, or leave the slot to a
   * brand-colour panel.
   */
  const [allowAiImages, setAllowAiImages] = useState(false);
  /**
   * Permission to use the shared curated LIBRARY — someone else's photograph,
   * licensed, of somewhere that is not this business.
   *
   * ON by default, matching the wire contract and every previous render from
   * this card (it never sent the field, and an unsent `allowStockImages` is
   * read as true). Turning it OFF with AI also off is the strictest setting
   * available — `own-only`, the org's real photos or a text-led design — and
   * it was unreachable from Claire's card until now, which is the exact thing
   * owners ask for when they say "only use real pictures of me".
   */
  const [allowStockImages, setAllowStockImages] = useState(true);
  const [graphic, setGraphic] = useState<Graphic | null>(null);
  // Spent, not unmounted — a card that vanishes on click takes the only
  // acknowledgement of the click with it.
  const [rejected, setRejected] = useState(false);
  const initializedServiceRef = useRef<string | null>(null);
  const userChangedSelectionRef = useRef(false);
  const { assets } = useListAssets({
    type: 'image',
    source: 'raw',
    limit: 100,
  });
  const { assets: serviceAssets, isLoading: serviceAssetsLoading } =
    useListAssetsByService(serviceId, 'image');
  const assetById = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset])),
    [assets]
  );
  const { generateGraphicAsync, isGenerating } = useGenerateGraphic({
    onSuccess: setGraphic,
  });

  // Has this proposal already been accepted? The one fact the card cannot know
  // about itself — React state forgets it on every remount, and a remount used
  // to hand the Accept button back over a graphic that had already been made.
  // Pressing it again generates a SECOND one and spends a second render.
  const { data: itemState } = useQuery({
    queryKey: queryKeys.contentBatches.itemState(itemId ?? '', attemptId),
    queryFn: () =>
      apiClient.get<{ assetId: string | null }>(
        // `attemptNumber=0` and not just the stamp. This card OPENED its item,
        // so the content it produced is attempt 0 by construction — and unlike
        // `attemptId` that needs nothing stored in the card to say so. Tool
        // outputs are persisted, so a card written before the stamp existed can
        // never gain one; without this it keeps reading the live cut and points
        // at whatever a later turn produced.
        `content-batches/items/${itemId}/state?attemptNumber=0${
          attemptId ? `&attemptId=${encodeURIComponent(attemptId)}` : ''
        }`
      ),
    enabled: Boolean(itemId),
    staleTime: 10_000,
  });
  const alreadyAccepted = Boolean(itemState?.assetId);
  // Between mount and the first answer we do not yet know whether this draft
  // was already accepted. Offering Accept in that window is offering a second
  // render — brief, but a double-press is exactly the kind of thing that fits
  // in a brief window.
  const acceptedUnknown = Boolean(itemId) && itemState === undefined;

  useEffect(() => {
    if (
      serviceAssetsLoading ||
      initializedServiceRef.current === serviceId ||
      userChangedSelectionRef.current
    ) {
      return;
    }

    initializedServiceRef.current = serviceId;
    setSelectedIds(getDefaultServiceImageIds(serviceAssets));
  }, [serviceAssets, serviceAssetsLoading, serviceId]);

  if (graphic) {
    return (
      <GraphicStatusCard
        itemId={itemId}
        data={{
          graphicId: graphic.id,
          status: graphic.status,
          title: graphic.title ?? undefined,
        }}
      />
    );
  }

  // Accepted in an EARLIER session — the graphic exists, but the state that
  // knew about it died with the last mount.
  //
  // `createContent` returns a `graphic_draft` card and no graphicId, because the
  // graphic is not made until Accept. So on reload the tool output alone can
  // never say what this draft produced; the ITEM can, and it is why the item is
  // opened before the content exists. Handing the id to the status card gets
  // the artifact row back, with its title and thumbnail, exactly as it looked
  // when it was made.
  //
  // Without this the card correctly refused to generate a second copy and then
  // showed nothing at all — the owner reopened the conversation to find a
  // spent draft and no sign of the graphic it had made.
  if (alreadyAccepted && itemState?.assetId) {
    return (
      <GraphicStatusCard
        itemId={itemId}
        data={{ graphicId: itemState.assetId }}
      />
    );
  }

  // Unique per card, so two draft cards in one transcript cannot share a
  // switch id — a duplicate id makes the label toggle the wrong card's switch.
  const switchScope = itemId ?? serviceId;
  const imageryOrder = describeImageryOrder({
    hasChosenImages: selectedIds.length > 0,
    allowStockImages,
    allowAiImages,
  });

  const startGeneration = async () => {
    if (isGenerating) return;
    setPickerOpen(false);
    await generateGraphicAsync({
      // Fills the proposal rather than opening a second item for the same
      // graphic — and it is what makes `alreadyAccepted` true afterwards.
      ...(itemId ? { itemId } : {}),
      serviceId,
      category: category as GraphicCategory,
      ...(kind === 'single' || kind === 'carousel' ? { kind } : {}),
      ...(topicSummary ? { topicSummary } : {}),
      // Service matches are preselected; a user change remains an ordered
      // override. If the service has no uploaded images, the renderer retains
      // its existing service-aware fallback.
      ...(selectedIds.length > 0 ? { sourceAssetIds: selectedIds } : {}),
      // The two FLAGS are the only things that permit imagery that is not the
      // org's own. Together they name the policy the renderer resolves to:
      // both off is `own-only` (real photos or a text-led design), stock alone
      // `own-then-stock`, AI alone `own-then-ai`, both `own-then-stock-then-ai`.
      // Uploads are tried FIRST under every one of them.
      allowAiImages,
      allowStockImages,
    }).catch(() => undefined);
  };

  return (
    <div className="w-full rounded-lg border bg-card p-4 sm:max-w-lg">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ImageIcon className="size-4 text-muted-foreground" />
        {title}
      </div>

      {fields.length > 0 && (
        <dl className="mt-3 space-y-1.5">
          {fields.map((field) => (
            <div
              key={field.label}
              className="flex items-baseline justify-between gap-3 text-xs"
            >
              <dt className="shrink-0 text-muted-foreground">{field.label}</dt>
              <dd className="truncate text-right font-medium">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {selectedIds.length > 0
              ? `Images (${selectedIds.length})`
              : 'Images'}
          </span>
        </div>

        {/* NOT a chooser, and not a blocker.
            This used to be an empty dashed box reading "Choose images" with
            Generate underneath it, so an org with nothing uploaded for this
            service — most of them — was asked to go and find images before it
            would do anything. The renderer has a service-aware fallback and
            builds these graphics perfectly well without uploads; the empty
            state was a chore invented by the card, not a real requirement. */}
        {selectedIds.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
            Using our own imagery for this one — add your own with Change Images
            if you would rather.
          </p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {selectedIds.map((id) => {
              const asset = assetById.get(id);
              return (
                <div
                  key={id}
                  className="relative aspect-[4/5] w-20 shrink-0 overflow-hidden rounded-md border bg-muted"
                >
                  {asset?.blobUrl || asset?.thumbnailUrl ? (
                    <img
                      src={asset.thumbnailUrl ?? asset.blobUrl}
                      alt={asset.name}
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="grid size-full place-items-center">
                      <ImageIcon className="size-4 text-muted-foreground/40" />
                    </div>
                  )}
                  {asset?.name && (
                    <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 text-[9px] text-white">
                      {asset.name}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* PERMISSIONS, not preferences — and worth stating as such, because
          "stock" and "AI images" read like style choices and are actually
          claims about whether the picture shows this business at all. With
          both off the graphic can only show the owner's real photos. */}
      <div className="mt-3 space-y-2 rounded-md border p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-0.5">
            <Label htmlFor={`allow-stock-images-${switchScope}`}>
              Allow curated stock photos
            </Label>
            <p className="text-xs text-muted-foreground">
              Licensed library images — real photographs, but not of this
              business.
            </p>
          </div>
          <Switch
            id={`allow-stock-images-${switchScope}`}
            checked={allowStockImages}
            onCheckedChange={setAllowStockImages}
            disabled={isGenerating}
          />
        </div>

        <div className="flex items-start justify-between gap-3 border-t pt-2">
          <div className="grid gap-0.5">
            <Label htmlFor={`allow-ai-images-${switchScope}`}>
              Allow AI-generated imagery
            </Label>
            <p className="text-xs text-muted-foreground">
              Invented images. Never presented as this business's own results.
            </p>
          </div>
          <Switch
            id={`allow-ai-images-${switchScope}`}
            checked={allowAiImages}
            onCheckedChange={setAllowAiImages}
            disabled={isGenerating}
          />
        </div>

        {/* The switches say what is PERMITTED; this says what will actually
            happen, in order. Two independent toggles quietly describe four
            different behaviours, and "own-only" in particular is easy to
            select by accident and impossible to recognise from the toggles. */}
        <p className="border-t pt-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Order:</span>{' '}
          {imageryOrder}
        </p>
      </div>

      {/* Reject / Change Images / Accept — the same three the clip list editor
          offers, because it is the same question: here is the thing, assembled,
          do you want it. Accept is LIVE from the moment the card appears;
          choosing images is an optional edit, never a prerequisite. */}
      {rejected ? (
        <p className="mt-4 text-[11px] text-muted-foreground">
          Discarded. Nothing was generated.
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={isGenerating}
            onClick={() => setRejected(true)}
          >
            <X className="size-3.5" />
            Reject
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={isGenerating}
            onClick={() => setPickerOpen(true)}
          >
            <Pencil className="size-3.5" />
            Change Images
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={isGenerating || acceptedUnknown}
            onClick={() => void startGeneration()}
          >
            {isGenerating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
            {isGenerating ? 'Starting…' : 'Accept'}
          </Button>
        </div>
      )}

      {!isGenerating && (
        <ImagePickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          selectedIds={selectedIds}
          onConfirm={(ids) => {
            userChangedSelectionRef.current = true;
            setSelectedIds(ids);
          }}
          serviceId={serviceId}
        />
      )}
    </div>
  );
}
