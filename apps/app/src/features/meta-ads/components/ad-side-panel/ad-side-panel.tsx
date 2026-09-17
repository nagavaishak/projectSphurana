import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertTriangle,
  Loader2,
  PencilIcon,
  SaveIcon,
  XIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { useSidePanel } from '@/components/app/side-panel';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CreativePreview } from '@/components/ui/creative-preview';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  type MessagingDestination,
  messagingDestinationLabels,
} from '@borradh-workspace/api-client/types';

import {
  type UpdateAdField,
  buildUpdateAdPayload,
  useDuplicateAd,
  useReplaceAdCreative,
  useUpdateAd,
} from '../../api';
import {
  type Ad,
  metaCallToActionLabels,
  metaCallToActionValues,
} from '../../api/types';
import { CreativePickerDialog, type PickedCreative } from '../creative-picker';

function statusVariant(
  status: Ad['status']
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'active':
      return 'default';
    case 'launching':
    case 'pending':
      return 'secondary';
    case 'rejected':
    case 'error':
      return 'destructive';
    default:
      return 'outline';
  }
}

const statusLabels: Record<Ad['status'], string> = {
  draft: 'Draft',
  launching: 'Launching',
  pending: 'In Review',
  active: 'Active',
  paused: 'Paused',
  rejected: 'Rejected',
  error: 'Error',
};

const editAdSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name is too long'),
  headline: z
    .string()
    .max(80, 'Headline must be 80 characters or less')
    .optional(),
  primaryText: z
    .string()
    .max(500, 'Primary text must be 500 characters or less')
    .optional(),
  description: z
    .string()
    .max(30, 'Description must be 30 characters or less')
    .optional(),
  callToAction: z.string().optional(),
  destinationUrl: z
    .string()
    .url('Must be a valid URL')
    .optional()
    .or(z.literal('')),
});

type FormData = z.infer<typeof editAdSchema>;

export interface AdSidePanelProps {
  ad: Ad;
}

/**
 * Inline (non-modal) side-panel body for viewing and editing an ad's creative.
 * Rendered in the dashboard {@link useSidePanel} host. The call-to-action and
 * destination URL are locked when the ad uses a messaging or lead-form
 * destination (they're determined by the ad set). Imported ads are read-only.
 */
export function AdSidePanel({ ad }: AdSidePanelProps) {
  const { close } = useSidePanel();
  const { executeAsync, isExecuting } = useUpdateAd();
  const { executeAsync: replaceCreativeAsync, isExecuting: isReplacing } =
    useReplaceAdCreative(false);
  const { executeAsync: duplicateAsync, isExecuting: isDuplicating } =
    useDuplicateAd();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [staged, setStaged] = useState<PickedCreative | null>(null);
  /** The live ad's creative cannot be swapped — explain, don't dead-end. */
  const [liveSwapOpen, setLiveSwapOpen] = useState(false);
  /** Live copy edit: confirm the re-review before it happens, not after. */
  const [confirmOpen, setConfirmOpen] = useState(false);

  const destinations = (ad.destinations as MessagingDestination[] | null) ?? [];
  // CTA + URL are derived from the ad set's destination when this ad routes to
  // messaging or a lead form — editing them here would have no effect.
  const destinationLocked = destinations.length > 0 || Boolean(ad.leadFormId);
  const readOnly = Boolean(ad.isImported);
  // `metaAdId` is what says the ad exists on Meta — the same test the service
  // makes before it touches Meta at all. Saving copy on such an ad does NOT
  // just edit a local row: Meta creatives are immutable, so the service mints a
  // new creative and swaps it onto the running ad, which sends it back through
  // review. Owners were getting that silently, with only an "Ad updated
  // successfully" toast.
  //
  // NOT `status !== 'draft'`: a publish that FAILED leaves `error` with no
  // `metaAdId`, and warning its owner that saving will pull a live ad back into
  // review describes an ad Meta never accepted. Same for `launching`.
  const isLive = Boolean(ad.metaAdId);

  // The server's rule for `PUT /meta-ads/:id/creative`, restated EXACTLY so the
  // owner meets it as an explained affordance rather than a red toast:
  // `replaceAdCreative` refuses anything but an unpublished Borradh draft —
  // `status !== 'draft' || isImported || useExistingPost || metaAdId !== null`.
  //
  // `status === 'draft'` is load-bearing on its own, and is NOT implied by "no
  // metaAdId": a publish that failed leaves `error` with a null `metaAdId`, so
  // gating on `!isLive` alone would offer a swap the server then refuses.
  const canSwapCreative =
    !readOnly && ad.status === 'draft' && !isLive && !ad.useExistingPost;

  /** Why the swap is unavailable — each reason is a different true sentence. */
  const swapBlockedReason: 'existing-post' | 'live' | 'not-draft' =
    ad.useExistingPost ? 'existing-post' : isLive ? 'live' : 'not-draft';

  const form = useForm<FormData>({
    resolver: zodResolver(editAdSchema),
    defaultValues: {
      name: ad.name,
      headline: ad.headline ?? '',
      primaryText: ad.primaryText ?? '',
      description: ad.description ?? '',
      callToAction: ad.callToAction,
      destinationUrl: ad.destinationUrl ?? '',
    },
  });

  const isSaving = isExecuting || isReplacing;
  const hasChanges = form.formState.isDirty || staged !== null;

  /**
   * Which fields the owner actually touched. `buildUpdateAdPayload` sends only
   * these, so a rename really is name-only and no longer rebuilds the creative.
   */
  const changedFields = (
    Object.keys(form.formState.dirtyFields) as UpdateAdField[]
  ).filter((field) => form.formState.dirtyFields[field]);

  /**
   * Saving will REPLACE the creative on Meta and put the ad back in review.
   *
   * True for a live ad when a CREATIVE field changed — the same five fields
   * `updateAdImpl` rebuilds a creative for. A rename does not qualify, and
   * that is now a fact rather than a hope: the payload no longer carries the
   * copy fields unless they were edited, so the server has nothing to rebuild
   * from. (Before that change a rename minted a new creative and paused
   * delivery with no warning at all — see `update-ad.payload.ts`.)
   */
  const willRestartReview =
    isLive && changedFields.some((field) => field !== 'name');

  /**
   * A creative swap and a copy edit are TWO requests with no transaction
   * between them, so a save can half-land. That cannot be designed away here
   * (a combined endpoint is a new mutating route, which the endpoint gate
   * rightly refuses without a port), so it is made legible instead.
   *
   * Media goes first: it is the bigger change, and if the server refuses it
   * there is no point writing the copy that was meant to go with it.
   *
   * What bounds the damage is WHERE this can happen. A creative swap is only
   * offered on an unpublished draft (`canSwapCreative`), so a half-applied
   * save never touches a delivering ad — no spend, no review, nothing a viewer
   * can see. The cost is a confused owner, and the answer to that is to say
   * exactly which half landed and leave the panel open so the other half can
   * be retried, rather than closing on a red toast and leaving them to guess.
   *
   * Not rolled back on purpose: the compensating write can fail too, and a
   * failed rollback leaves the ad in a third state nobody asked for, after a
   * request the owner never made.
   */
  const applyChanges = async (data: FormData) => {
    let creativeLanded = false;
    try {
      if (staged) {
        await replaceCreativeAsync({
          adId: ad.id,
          ...(staged.videoId ? { videoId: staged.videoId } : {}),
          ...(staged.graphicId ? { graphicId: staged.graphicId } : {}),
        });
        creativeLanded = true;
      }
      if (form.formState.isDirty) {
        await executeAsync({
          adId: ad.id,
          data: buildUpdateAdPayload(
            { ...data, destinationLocked },
            changedFields
          ),
        });
      } else if (staged) {
        toast.success('Creative replaced');
      }
      close();
    } catch {
      // Each hook has already said WHAT failed. Only the split case needs
      // more: the owner is looking at a panel whose media has changed on the
      // server and whose text has not.
      if (creativeLanded) {
        // The pick is applied — dropping it stops Save from re-sending a swap
        // that already happened, and leaves the form dirty so the retry is
        // exactly the half that failed.
        setStaged(null);
        toast.warning(
          'The new creative was saved — your text changes were not',
          {
            description:
              'The image or video on this ad has been replaced. Press Save again to retry the copy changes.',
            duration: 10_000,
          }
        );
      }
      // Panel stays open either way: closing would discard edits the owner
      // would have to type again.
    }
  };

  const onSubmit = async (data: FormData) => {
    // Nothing edited — don't fire a no-op update (and its toast).
    if (!hasChanges) {
      close();
      return;
    }
    // Ask BEFORE the write, not with a notice the owner has already scrolled
    // past: this one pauses delivery on an ad that is currently spending.
    if (willRestartReview) {
      setConfirmOpen(true);
      return;
    }
    await applyChanges(data);
  };

  // Prefer the local high-res sources (rendered graphic image / video poster)
  // over Meta's low-res thumbnail. graphicImageUrl is only set for image ads,
  // and for image ads `video.thumbnailUrl` falls back to the low-res Meta
  // thumbnail — so the graphic image must come first or it gets short-circuited.
  const previewVideo = staged ? staged.videoUrl : ad.video?.videoUrl;
  const previewMedia = staged
    ? staged.thumbnailUrl
    : ad.graphicImageUrl || ad.video?.thumbnailUrl || ad.metaThumbnailUrl;
  // Intrinsic dimensions, where the server knows them, so the frame is the
  // right shape on first paint: a rendered graphic stores its size, and so does
  // an uploaded asset. Everything else is measured from the media on load.
  const usingGraphic = Boolean(ad.graphicImageUrl) && !previewVideo;
  // A staged pick has no stored dimensions here, so hand the frame nulls and
  // let it measure the media on load rather than shaping it to the OLD
  // creative and letterboxing the new one.
  const previewWidth = staged
    ? null
    : usingGraphic
      ? ad.graphicImageWidth
      : (ad.video?.width ?? null);
  const previewHeight = staged
    ? null
    : usingGraphic
      ? ad.graphicImageHeight
      : (ad.video?.height ?? null);

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex h-full min-h-0 flex-col"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b p-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-semibold">{ad.name}</h2>
              <Badge variant={statusVariant(ad.status)} className="shrink-0">
                {statusLabels[ad.status]}
              </Badge>
            </div>
            {ad.adPlacement ? (
              <p className="mt-1 text-sm capitalize text-muted-foreground">
                {ad.adPlacement} placement
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground"
            onClick={close}
            aria-label="Close panel"
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {/* Creative preview — just the media, no ad-card chrome */}
          <div className="relative">
            <CreativePreview
              videoUrl={previewVideo}
              imageUrl={previewMedia}
              alt={ad.name}
              width={previewWidth}
              height={previewHeight}
            />
            {!readOnly && (
              <Button
                type="button"
                size="icon"
                variant="secondary"
                aria-label="Change creative"
                title={
                  canSwapCreative
                    ? 'Change creative'
                    : 'This ad is on Meta — its creative cannot be swapped in place'
                }
                className="absolute right-2 top-2 size-8 shadow-sm"
                onClick={() =>
                  canSwapCreative ? setPickerOpen(true) : setLiveSwapOpen(true)
                }
              >
                <PencilIcon className="size-4" />
              </Button>
            )}
          </div>

          {staged && (
            <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 p-3 text-sm">
              <span className="min-w-0 truncate">
                New creative:{' '}
                <span className="font-medium">{staged.label}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStaged(null)}
              >
                Undo
              </Button>
            </div>
          )}

          {readOnly && (
            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              This ad was imported from Meta and can&apos;t be edited here.
            </p>
          )}

          {isLive && !readOnly && (
            <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>
                This ad is live. Saving replaces its creative on Meta and sends
                the ad back for review, so delivery can pause until Meta
                approves it.
              </p>
            </div>
          )}

          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Ad name</FormLabel>
                <FormControl>
                  <Input placeholder="My Ad" disabled={readOnly} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="primaryText"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Primary text (caption)</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Main ad copy"
                    maxLength={500}
                    rows={4}
                    disabled={readOnly}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="headline"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Headline</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Catchy headline"
                    maxLength={80}
                    disabled={readOnly}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Short description"
                    maxLength={30}
                    disabled={readOnly}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="callToAction"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Call to action</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value}
                  disabled={readOnly || destinationLocked}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a call to action" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {metaCallToActionValues.map((value) => (
                      <SelectItem key={value} value={value}>
                        {metaCallToActionLabels[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="destinationUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Destination URL</FormLabel>
                <FormControl>
                  <Input
                    type="url"
                    placeholder="https://example.com"
                    disabled={readOnly || destinationLocked}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {destinationLocked && (
            <div className="space-y-2 rounded-md border bg-muted/40 p-3">
              {destinations.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {destinations.map((d) => (
                    <Badge key={d} variant="secondary">
                      {messagingDestinationLabels[d] ?? d}
                    </Badge>
                  ))}
                </div>
              )}
              <FormDescription>
                The button and destination are set by this ad&apos;s
                {destinations.length > 0 ? ' messaging' : ' lead-form'}{' '}
                destination and can&apos;t be changed here.
              </FormDescription>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t p-4">
          <Button type="button" variant="outline" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={readOnly || !hasChanges || isSaving}
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <SaveIcon className="size-4" />
            )}
            {isSaving ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </form>

      <CreativePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={setStaged}
      />

      {/*
        A live ad's creative is immutable on Meta, so there is nothing to swap
        into. Rather than a disabled button with no explanation — or worse, a
        request the server refuses — say why, and offer the route that does
        work: a duplicate comes back as an editable draft that spends nothing
        until it is launched.
      */}
      <AlertDialog open={liveSwapOpen} onOpenChange={setLiveSwapOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              This ad&apos;s creative can&apos;t be swapped here
            </AlertDialogTitle>
            <AlertDialogDescription>
              {swapBlockedReason === 'existing-post'
                ? 'This ad runs an existing page post, so its media belongs to the post rather than to the ad.'
                : swapBlockedReason === 'live'
                  ? 'Meta creatives are fixed once an ad is on Meta, so the video or image on a published ad cannot be replaced in place — only its copy can.'
                  : `This ad is no longer an editable draft (it is ${statusLabels[ad.status].toLowerCase()}), and media can only be swapped before an ad has been sent to Meta.`}{' '}
              To run different media, duplicate this ad: the copy comes back as
              a draft you can re-shoot and launch, and nothing spends until you
              do.{' '}
              {swapBlockedReason === 'live'
                ? 'This ad keeps running in the meantime.'
                : 'This ad is left exactly as it is.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDuplicating}
              onClick={async (event) => {
                event.preventDefault();
                try {
                  await duplicateAsync(ad.id);
                  setLiveSwapOpen(false);
                  close();
                } catch {
                  // handled by the hook's onError toast
                }
              }}
            >
              {isDuplicating ? 'Duplicating...' : 'Duplicate this ad'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/*
        The consequence an owner must agree to BEFORE it happens: this ad is
        delivering and spending right now, and saving stops that until Meta
        clears the new creative.
      */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Replace the creative and send it back for review?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{ad.name}</strong> is live on Meta. Meta creatives
              can&apos;t be edited, so saving builds a new one and swaps it onto
              the running ad, which puts the ad back through review. Delivery
              can pause until that clears — usually a short while. Your existing
              results and spend are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>
              Keep it running
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isSaving}
              onClick={async (event) => {
                event.preventDefault();
                setConfirmOpen(false);
                await applyChanges(form.getValues());
              }}
            >
              {isSaving ? 'Saving...' : 'Replace and send for review'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Form>
  );
}
