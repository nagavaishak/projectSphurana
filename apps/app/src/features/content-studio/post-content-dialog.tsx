import { zodResolver } from '@hookform/resolvers/zod';
import { format, parse, startOfDay } from 'date-fns';
import {
  CheckIcon,
  FacebookIcon,
  InstagramIcon,
  Loader2,
  SendIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { useListMetaAdsPages } from '@/features/integrations';
import {
  SocialPostPreview,
  useCreateSocialPost,
  usePublishSocialPost,
} from '@/features/social-posts';
import {
  type CreateSocialPostFormValues,
  createSocialPostForm,
} from '@/features/social-posts/api';
import type { SocialPostPlatform } from '@/features/social-posts/types';
import { cn } from '@/lib/utils';
import type { PostableMedia } from './postable-media';

/**
 * Schema, defaults and labels all come from the ONE shared declaration every
 * create-social-post surface renders from.
 *
 * THIS is the dialog that shipped the bug the declaration exists to make
 * unspellable: `date`/`time` were absent from its `defaultValues`. Untouched,
 * the form sits in `mode: 'now'` where both are optional, so nothing looked
 * wrong — until the user picked "Schedule for Later", at which point submit sent
 * `undefined` and zod reported "expected string, received undefined" against two
 * fields they could see were filled in. Under `defineForm` a field cannot be
 * declared without a default, so that is now a compile error.
 */
const L = createSocialPostForm.labels;

type PostContentFormData = CreateSocialPostFormValues;

interface PostContentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The tile being posted. `PostableMedia`, not `Asset` — a gallery tile may be
   * a multi-slide carousel, which `Asset` cannot express.
   */
  asset: PostableMedia;
  onSuccess?: () => void;
}

export function PostContentDialog({
  open,
  onOpenChange,
  asset,
  onSuccess,
}: PostContentDialogProps) {
  const [pagesPopoverOpen, setPagesPopoverOpen] = useState(false);

  const { pages, isLoading: isPagesLoading } = useListMetaAdsPages();

  const { createSocialPostAsync, isCreating } = useCreateSocialPost({
    showToast: false,
  });
  const { publishSocialPost: firePublish } = usePublishSocialPost();

  const now = new Date();

  const form = useForm<PostContentFormData>({
    resolver: zodResolver(createSocialPostForm.schema),
    defaultValues: {
      ...createSocialPostForm.defaults,
      // This surface starts on "Post Now"; the other two only ever schedule.
      mode: 'now',
      title: asset.name,
      // The media is carried in from the gallery the user already picked it in
      // — this dialog posts THAT asset, so its media fields are seeded, not
      // chosen. `thumbnailUrl` was previously dropped here, so a video posted
      // from content-studio lost its poster frame.
      mediaId: asset.id,
      mediaType: asset.type === 'video' ? 'video' : 'image',
      // Slide 1 for a carousel. The rest of the slides and the source
      // reference are NOT form fields — nothing here edits them — so they are
      // read straight off the prop at submit rather than round-tripped through
      // form state, which would need a default per field and a contract fill.
      mediaUrl: asset.blobUrl,
      thumbnailUrl: asset.thumbnailUrl ?? '',
      // A dialog opened today must default to today, so the schedule is seeded
      // at mount rather than at module load.
      date: format(now, 'yyyy-MM-dd'),
      time: format(now, 'HH:mm'),
    },
  });

  const mode = form.watch('mode');
  const selectedPageIds = form.watch('pageIds');
  const watchedCaption = form.watch('caption');

  // Derive preview info
  const previewPage = pages.find((p) => selectedPageIds.includes(p.id));
  const previewPlatform: SocialPostPlatform =
    (previewPage?.platform as SocialPostPlatform) ?? 'facebook';
  const previewProfilePage = pages.find(
    (p) => p.platform === previewPlatform && p.isActive
  );

  const togglePage = (pageId: string) => {
    const current = form.getValues('pageIds');
    if (current.includes(pageId)) {
      form.setValue(
        'pageIds',
        current.filter((id) => id !== pageId),
        { shouldValidate: true }
      );
    } else {
      form.setValue('pageIds', [...current, pageId], { shouldValidate: true });
    }
  };

  const getSelectedPagesLabel = () => {
    if (selectedPageIds.length === 0) return 'Select pages...';
    if (selectedPageIds.length === 1) {
      const page = pages.find((p) => p.id === selectedPageIds[0]);
      // `pageName` can be null (Meta doesn't always give one back, and the
      // integration seed leaves it unset). The DROPDOWN already falls back to
      // `pageId` for exactly that case — `{page.pageName || page.pageId}` — so
      // falling back to a bare "1 page selected" here threw the identity away:
      // you picked a specific page and the trigger then refused to say which.
      // Identify it the same way the list does.
      return page?.pageName || page?.pageId || '1 page selected';
    }
    return `${selectedPageIds.length} pages selected`;
  };

  const handleSubmit = async (data: PostContentFormData) => {
    const baseIntent = {
      title: data.title,
      caption: data.caption,
      mediaType: data.mediaType,
      mediaUrl: data.mediaUrl,
      thumbnailUrl: data.thumbnailUrl || undefined,
      // Media identity, straight from the tile — see `defaultValues`.
      mediaUrls: asset.mediaUrls,
      graphicId: asset.graphicId,
      videoId: asset.videoId,
      pageIds: data.pageIds,
    };

    if (data.mode === 'now') {
      const post = await createSocialPostAsync({
        ...baseIntent,
        schedule: { mode: 'now' },
      });
      // Fire publish in background - don't block the UI.
      // The usePublishSocialPost hook shows success/error toasts via its callbacks.
      firePublish(post.id);
    } else {
      await createSocialPostAsync({
        ...baseIntent,
        schedule: { mode: 'schedule', date: data.date, time: data.time },
      });
      toast.success('Post scheduled successfully');
    }

    onOpenChange(false);
    onSuccess?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Post Content</DialogTitle>
          <DialogDescription>
            Post this content to your social media pages.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[1fr,auto]">
          <div>
            {/* Asset thumbnail */}
            <div className="flex items-center gap-3 rounded-md border bg-muted/50 px-3 py-2 mb-4">
              <div className="relative size-10 shrink-0 overflow-hidden rounded">
                {asset.type === 'video' ? (
                  <video
                    src={asset.blobUrl}
                    className="size-full object-cover"
                    muted
                    playsInline
                    preload="metadata"
                    onLoadedData={(e) => {
                      e.currentTarget.currentTime = 0.001;
                    }}
                  />
                ) : (
                  <img
                    src={asset.blobUrl}
                    alt={asset.name}
                    className="absolute inset-0 size-full object-cover"
                  />
                )}
              </div>
              <span className="truncate text-sm font-medium">{asset.name}</span>
            </div>

            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className="space-y-4"
            >
              <Controller
                name="title"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>{L.title}</FieldLabel>
                    <Input
                      {...field}
                      id={field.name}
                      placeholder="Enter post title"
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.error && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />

              <Controller
                name="caption"
                control={form.control}
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>{L.caption}</FieldLabel>
                    <Textarea
                      {...field}
                      id={field.name}
                      placeholder="Enter post caption"
                      rows={3}
                    />
                  </Field>
                )}
              />

              {/* Page selector */}
              <Field data-invalid={!!form.formState.errors.pageIds}>
                <FieldLabel>{L.pageIds}</FieldLabel>
                {isPagesLoading ? (
                  <div className="h-10 rounded-md border bg-muted/50 animate-pulse" />
                ) : pages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No connected pages. Connect Meta or Instagram in Settings
                    first.
                  </p>
                ) : (
                  <Popover
                    open={pagesPopoverOpen}
                    onOpenChange={setPagesPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={pagesPopoverOpen}
                        className="w-full justify-between"
                        type="button"
                      >
                        <span className="truncate">
                          {getSelectedPagesLabel()}
                        </span>
                        <div className="flex items-center gap-1">
                          {selectedPageIds.length > 0 && (
                            <Badge variant="secondary" className="ml-2">
                              {selectedPageIds.length}
                            </Badge>
                          )}
                        </div>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[300px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search pages..." />
                        <CommandList>
                          <CommandEmpty>No pages found.</CommandEmpty>
                          <CommandGroup>
                            {pages.map((page) => (
                              <CommandItem
                                key={page.id}
                                value={page.pageName || page.pageId}
                                onSelect={() => togglePage(page.id)}
                              >
                                <div
                                  className={cn(
                                    'mr-2 flex size-4 items-center justify-center rounded-sm border border-primary',
                                    selectedPageIds.includes(page.id)
                                      ? 'bg-primary text-primary-foreground'
                                      : 'opacity-50 [&_svg]:invisible'
                                  )}
                                >
                                  <CheckIcon className="size-3" />
                                </div>
                                {page.platform === 'facebook' ? (
                                  <FacebookIcon className="mr-2 size-4 text-blue-600" />
                                ) : (
                                  <InstagramIcon className="mr-2 size-4 text-pink-600" />
                                )}
                                <span className="truncate">
                                  {page.pageName || page.pageId}
                                </span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                )}
                {form.formState.errors.pageIds && (
                  <FieldError errors={[form.formState.errors.pageIds]} />
                )}
              </Field>

              {/* Mode toggle */}
              <Controller
                name="mode"
                control={form.control}
                render={({ field }) => (
                  <Field>
                    <FieldLabel>When</FieldLabel>
                    <RadioGroup
                      value={field.value}
                      onValueChange={field.onChange}
                      className="flex gap-4"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="now" id="mode-now" />
                        <label
                          htmlFor="mode-now"
                          className="text-sm cursor-pointer"
                        >
                          Post Now
                        </label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="schedule" id="mode-schedule" />
                        <label
                          htmlFor="mode-schedule"
                          className="text-sm cursor-pointer"
                        >
                          Schedule for Later
                        </label>
                      </div>
                    </RadioGroup>
                  </Field>
                )}
              />

              {/* Date/time fields (schedule mode only) */}
              {mode === 'schedule' && (
                <div className="grid grid-cols-2 gap-4">
                  <Controller
                    name="date"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name}>{L.date}</FieldLabel>
                        <DatePicker
                          id={field.name}
                          placeholder="Select date"
                          value={
                            field.value
                              ? parse(field.value, 'yyyy-MM-dd', new Date())
                              : undefined
                          }
                          onChange={(date) =>
                            field.onChange(
                              date ? format(date, 'yyyy-MM-dd') : ''
                            )
                          }
                          calendarDisabled={{ before: startOfDay(now) }}
                          aria-invalid={fieldState.invalid}
                        />
                        {fieldState.error && (
                          <FieldError errors={[fieldState.error]} />
                        )}
                      </Field>
                    )}
                  />

                  <Controller
                    name="time"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name}>{L.time}</FieldLabel>
                        <Input
                          {...field}
                          value={field.value ?? ''}
                          id={field.name}
                          type="time"
                          aria-invalid={fieldState.invalid}
                        />
                        {fieldState.error && (
                          <FieldError errors={[fieldState.error]} />
                        )}
                      </Field>
                    )}
                  />
                </div>
              )}

              <DialogFooter>
                <Button type="submit" disabled={isCreating}>
                  {isCreating ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <SendIcon className="size-4" />
                  )}
                  {isCreating
                    ? mode === 'now'
                      ? 'Posting...'
                      : 'Scheduling...'
                    : mode === 'now'
                      ? 'Post Now'
                      : 'Schedule'}
                </Button>
              </DialogFooter>
            </form>
          </div>

          {/* Live Preview */}
          <div className="hidden md:flex flex-col items-center pt-2">
            <SocialPostPreview
              platform={previewPlatform}
              imageUrl={asset.blobUrl}
              caption={watchedCaption || ''}
              profileImageUrl={previewProfilePage?.pagePictureUrl ?? undefined}
              profileName={
                previewProfilePage?.pageUsername ??
                previewProfilePage?.pageName ??
                undefined
              }
              className="w-64"
            />
            <p className="mt-2 text-xs text-muted-foreground">Live Preview</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
