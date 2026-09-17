import type { ListedService } from '@borradh-workspace/api-client/types';
import { ImageIcon, Sparkles, Upload, Video } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useLinkAssetServices } from '@/features/assets/api/update-asset-services/update-asset-services.hook';
import { MassVideoUploadDialog } from '@/features/assets/components/mass-video-upload-dialog';
import { useListServices } from '@/features/organization-services';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface CreateBatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: {
    serviceIds: string[];
    /**
     * The mix this dialog PROMISED on screen. Passed through rather than
     * re-decided by the caller: both callers used to hardcode 6 + 6 while the
     * dialog rendered "3 graphics + 3 videos" above the button, so the number
     * the owner agreed to was not the number requested.
     */
    graphicCount: number;
    videoCount: number;
  }) => void;
  /** Whether the parent's generate mutation is in flight. */
  isSubmitting?: boolean;
}

/**
 * Slots requested per available modality — six graphics and two videos is the
 * real monthly batch. The modalities are NOT symmetric: a graphic slot is one
 * image-model call, a video slot is a full render.
 *
 * Local development halves it to three graphics and one video: a dev batch
 * renders real videos and calls real image models, and nobody working on the
 * dialog needs the full mix to see the flow. `import.meta.env.DEV` is false in
 * every built bundle (preview, staging, production), so only `pnpm dev` gets
 * the reduced mix.
 *
 * The server mirrors these as `DEFAULT_BATCH_GRAPHIC_COUNT` /
 * `DEFAULT_BATCH_VIDEO_COUNT` (keyed off `NODE_ENV`) for the paths that don't
 * come through this dialog — the schema default and the onboarding seed. They
 * must move together. They are not imported from there because the frontend
 * does not depend on the features package.
 */
const GRAPHIC_COUNT = import.meta.env.DEV ? 3 : 6;
const VIDEO_COUNT = import.meta.env.DEV ? 1 : 2;

/**
 * Pre-creation dialog for the monthly content batch.
 *
 * The user picks which services the batch should cover (a hard filter — the
 * planner only considers these). Videos come from a service's OWN uploaded
 * footage or, when the fallback is enabled, the stock-footage bank (uploaded
 * clips stay the first choice); graphics still require an uploaded image. The
 * summary is deliberately honest: each available modality gets its canonical
 * slot count, a modality with no source gets zero. Uploads can be added and
 * linked without leaving the dialog.
 */
export function CreateBatchDialog({
  open,
  onOpenChange,
  onConfirm,
  isSubmitting,
}: CreateBatchDialogProps) {
  const { services, isLoading, isError, refetch } = useListServices({
    isActive: true,
  });
  const { linkServicesAsync } = useLinkAssetServices();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Which service's upload dialog is currently open (null = none).
  const [uploadFor, setUploadFor] = useState<ListedService | null>(null);

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const outputMix = useMemo(() => {
    const chosen = services.filter((service) => selected.has(service.id));
    // Every selected service can back both modalities, so the mix depends only
    // on whether anything is selected.
    //
    // There is no "allow stock/AI" question any more. `resolve-slot-image` and
    // the footage selector already walk uploaded-first ladders — the org's own
    // media wins wherever it exists, and the fallback only fills the gap it
    // leaves. Asking permission for that was asking a per-batch question about
    // a per-slot decision, and the answer was implied the moment a service with
    // nothing uploaded was selected.
    //
    // THIS IS THE REQUESTED MIX, not a label. It is handed to `onConfirm` and
    // travels to the API — the two must not be able to disagree, because the
    // number rendered here is what the owner is agreeing to.
    return {
      graphicCount: chosen.length > 0 ? GRAPHIC_COUNT : 0,
      videoCount: chosen.length > 0 ? VIDEO_COUNT : 0,
    };
  }, [services, selected]);
  const canSubmit =
    selected.size > 0 &&
    outputMix.graphicCount + outputMix.videoCount > 0 &&
    !isSubmitting;

  const handleUploadSuccess = async (serviceId: string, assetIds: string[]) => {
    if (assetIds.length > 0) {
      await Promise.all(
        assetIds.map((assetId) =>
          linkServicesAsync({ assetId, serviceIds: [serviceId] })
        )
      );
    }
    setUploadFor(null);
    // Refetch so the newly-linked footage flips hasVideoFootage → unblocks.
    await refetch();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create content batch</DialogTitle>
            <DialogDescription>
              Choose which services this month&apos;s content should cover.
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : isError ? (
            // BEFORE the empty state: `services` falls back to [] on a failed
            // request, so a clinic with a full catalogue was told to "add a
            // service first" and left unable to create a batch at all.
            <div className="space-y-3 py-6 text-center">
              <p className="text-sm text-destructive">
                Couldn&apos;t load your services.
              </p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          ) : services.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              You have no active services yet. Add a service first to create
              content.
            </p>
          ) : (
            // A plain scroll container, NOT `ScrollArea`. Radix's Root is
            // `overflow: hidden` and its Viewport is `size-full`, so against a
            // parent with only a `max-h` (height: auto) the viewport resolves
            // to its content height, overflows, and gets clipped by the Root
            // with no scrollbar — the tail of the list is rendered but
            // unreachable. Every ScrollArea in the app that works pairs a
            // resolved `h-[…]`/`flex-1` with it. A fixed height is wrong here
            // (an org with two services would get a mostly-empty box), so this
            // uses native overflow, which honours `max-height` correctly.
            <div className="max-h-[360px] overflow-y-auto pr-1">
              <div className="space-y-2">
                {services.map((service) => {
                  const isSelected = selected.has(service.id);
                  return (
                    <div
                      key={service.id}
                      className={cn(
                        'rounded-lg border p-3 transition-colors',
                        isSelected
                          ? 'border-primary bg-primary/5'
                          : 'border-input'
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox
                          id={`svc-${service.id}`}
                          checked={isSelected}
                          onCheckedChange={() => toggleSelected(service.id)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <label
                            htmlFor={`svc-${service.id}`}
                            className="cursor-pointer font-medium"
                          >
                            {service.name}
                          </label>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            <Badge
                              variant={
                                service.hasGraphicMedia
                                  ? 'secondary'
                                  : 'outline'
                              }
                              className="gap-1"
                            >
                              <ImageIcon className="size-3" />
                              {service.hasGraphicMedia ? 'Photos' : 'No photos'}
                            </Badge>
                            <Badge
                              variant={
                                service.hasVideoFootage
                                  ? 'secondary'
                                  : 'outline'
                              }
                              className="gap-1"
                            >
                              <Video className="size-3" />
                              {service.hasVideoFootage ? 'Video' : 'No video'}
                            </Badge>
                          </div>

                          {isSelected && !service.hasVideoFootage && (
                            <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-muted/50 p-2">
                              <span className="text-xs text-muted-foreground">
                                Videos will use stock footage. Upload clips to
                                use your own instead.
                              </span>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setUploadFor(service)}
                              >
                                <Upload className="size-3.5" />
                                Upload
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {selected.size > 0 && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">This batch will create</span>
                <span>
                  {outputMix.graphicCount} graphics + {outputMix.videoCount}{' '}
                  videos
                </span>
              </div>
              {outputMix.graphicCount + outputMix.videoCount === 0 && (
                <p className="text-xs text-destructive">
                  Upload an image or render-ready video for a selected service
                  to continue.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={!canSubmit}
              onClick={() =>
                onConfirm({
                  serviceIds: [...selected],
                  graphicCount: outputMix.graphicCount,
                  videoCount: outputMix.videoCount,
                })
              }
            >
              <Sparkles />
              {isSubmitting ? 'Creating…' : 'Create batch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Per-service footage upload. Mounted only while a service is targeted
          so onSuccess can link the new clips to the right service. */}
      {uploadFor && (
        <MassVideoUploadDialog
          open={!!uploadFor}
          onOpenChange={(o) => !o && setUploadFor(null)}
          title={`Upload video for ${uploadFor.name}`}
          description="These clips will be linked to this service and used for its videos."
          onSuccess={(assetIds) => handleUploadSuccess(uploadFor.id, assetIds)}
        />
      )}
    </>
  );
}
