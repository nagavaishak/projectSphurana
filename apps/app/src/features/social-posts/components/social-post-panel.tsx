import { zodResolver } from '@hookform/resolvers/zod';
import { format, isFuture, parse, parseISO } from 'date-fns';
import {
  CalendarClock,
  FacebookIcon,
  InstagramIcon,
  Loader2,
  SaveIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { useSidePanel } from '@/components/app/side-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useListMetaAdsPages } from '@/features/integrations';
import { useActiveOrganization } from '@/features/organization/api/get-active-organization';
import { zonedEvent } from '@/lib/timezone';

import {
  type UpdateSocialPostFormValues,
  updateSocialPostForm,
  useDeleteSocialPost,
  useGetSocialPost,
  useUpdateSocialPost,
} from '../api';
import { isSocialPostEditable } from '../social-post-lifecycle';
import type {
  SocialPost,
  SocialPostPlatform,
  SocialPostStatus,
} from '../types';
import { SocialPostPreview } from './social-post-preview';

const STATUS_VARIANTS: Record<
  SocialPostStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  draft: 'outline',
  scheduled: 'secondary',
  publishing: 'secondary',
  published: 'default',
  partial: 'secondary',
  failed: 'destructive',
};

const STATUS_LABELS: Record<SocialPostStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  publishing: 'Publishing',
  published: 'Published',
  partial: 'Partially published',
  failed: 'Failed',
};

const PLATFORM_ICONS: Record<SocialPostPlatform, typeof FacebookIcon> = {
  facebook: FacebookIcon,
  instagram: InstagramIcon,
};

const PLATFORM_LABELS: Record<SocialPostPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
};

/**
 * Schema, defaults and labels all come from the ONE shared declaration every
 * edit-social-post surface renders from.
 */
const L = updateSocialPostForm.labels;

type FormData = UpdateSocialPostFormValues;

export interface SocialPostPanelProps {
  /** Pass a loaded post directly (list view), or just an id to fetch it. */
  post?: SocialPost;
  postId?: string;
}

/**
 * Inline (non-modal) side-panel body for viewing and editing a post. Rendered
 * inside the dashboard {@link useSidePanel} host. Title, caption and — for posts
 * still scheduled in the future — the schedule are editable; the assigned page
 * and platforms are read-only.
 */
export function SocialPostPanel({
  post: postProp,
  postId,
}: SocialPostPanelProps) {
  const id = postProp?.id ?? postId ?? '';
  const { post: fetched, isLoading } = useGetSocialPost({
    id,
    queryConfig: { enabled: !postProp && !!postId },
  });
  const post = postProp ?? fetched;

  if (!post) {
    return (
      <>
        <PanelHeaderShell />
        <div className="flex flex-col gap-4 p-4">
          {isLoading ? (
            <>
              <Skeleton className="aspect-square w-56 self-center rounded-lg" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-24 w-full" />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Post not found.</p>
          )}
        </div>
      </>
    );
  }

  return <SocialPostPanelBody post={post} />;
}

function PanelHeaderShell({ children }: { children?: React.ReactNode }) {
  const { close } = useSidePanel();
  return (
    <div className="flex items-start justify-between gap-2 border-b p-4">
      <div className="min-w-0 flex-1">{children}</div>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground"
        onClick={close}
        aria-label="Close panel"
      >
        <XIcon className="size-4" />
      </Button>
    </div>
  );
}

function SocialPostPanelBody({ post }: { post: SocialPost }) {
  const { close } = useSidePanel();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const { pages } = useListMetaAdsPages();
  const { data: organization } = useActiveOrganization();
  const timeZone = organization?.timezone ?? 'UTC';
  const { updateSocialPostAsync, isUpdating } = useUpdateSocialPost({
    onSuccess: () => close(),
  });
  const { deleteSocialPostAsync, isDeleting } = useDeleteSocialPost({
    onSuccess: () => close(),
  });

  const platforms: SocialPostPlatform[] = Array.isArray(post.platforms)
    ? (post.platforms as SocialPostPlatform[])
    : [];

  const scheduledDate = post.scheduledAt ? parseISO(post.scheduledAt) : null;
  // Wall-clock of the stored instant in the BUSINESS zone — used to seed the
  // date/time pickers and for display, so the round-trip stays in the org's
  // zone (the update hook converts the picked wall-clock back the same way).
  const zonedScheduled = post.scheduledAt
    ? zonedEvent(post.scheduledAt, timeZone)
    : null;
  // Schedule can only change while a post is still pending and in the future.
  const scheduleEditable =
    post.status !== 'publishing' &&
    post.status !== 'published' &&
    post.status !== 'partial' &&
    !!scheduledDate &&
    isFuture(scheduledDate);
  // Publishing and published posts are immutable in the API.
  const fieldsEditable = isSocialPostEditable(post.status);

  const form = useForm<FormData>({
    resolver: zodResolver(updateSocialPostForm.schema),
    defaultValues: {
      ...updateSocialPostForm.defaults,
      title: post.title,
      caption: post.caption ?? '',
      date: zonedScheduled ? format(zonedScheduled, 'yyyy-MM-dd') : '',
      time: zonedScheduled ? format(zonedScheduled, 'HH:mm') : '',
    },
  });

  const watchedCaption = form.watch('caption');

  // Read-only preview info.
  const isVideo = post.mediaType === 'video';
  const previewImageUrl = isVideo
    ? (post.thumbnailUrl ?? post.mediaUrl ?? '')
    : (post.mediaUrl ?? '');
  const previewPlatform: SocialPostPlatform = platforms[0] ?? 'facebook';
  const previewPage = pages.find(
    (p) => p.platform === previewPlatform && p.isActive
  );
  // The pages this post publishes to (read-only — can't be reassigned here).
  const assignedPages = pages.filter((p) =>
    platforms.includes(p.platform as SocialPostPlatform)
  );
  const assignedPagesLabel =
    assignedPages.length > 0
      ? assignedPages.map((p) => p.pageName || p.pageId).join(', ')
      : platforms.map((p) => PLATFORM_LABELS[p]).join(', ') || 'No page';

  const handleSubmit = async (data: FormData) => {
    // Nothing edited — don't fire a no-op update (and its toast).
    if (!form.formState.isDirty) {
      close();
      return;
    }

    // The builder owns the date/time → ISO conversion and caption normalisation.
    await updateSocialPostAsync({
      id: post.id,
      title: data.title,
      caption: data.caption ?? '',
      ...(scheduleEditable
        ? { schedule: { date: data.date, time: data.time } }
        : {}),
    });
  };

  return (
    <form
      onSubmit={form.handleSubmit(handleSubmit)}
      className="flex h-full min-h-0 flex-col"
    >
      <PanelHeaderShell>
        <div className="flex items-center gap-2 pr-1">
          <h2 className="truncate text-base font-semibold">{post.title}</h2>
          <Badge variant={STATUS_VARIANTS[post.status]} className="shrink-0">
            {STATUS_LABELS[post.status]}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {scheduledDate ? (
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="size-3.5" />
              {post.status === 'published' ? 'Published ' : 'Scheduled '}
              {zonedScheduled ? format(zonedScheduled, 'PPp') : ''}
            </span>
          ) : (
            'Draft post'
          )}
        </p>
      </PanelHeaderShell>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        {/* Live preview */}
        <div className="flex flex-col items-center">
          <SocialPostPreview
            platform={previewPlatform}
            imageUrl={previewImageUrl}
            caption={watchedCaption || ''}
            profileImageUrl={previewPage?.pagePictureUrl ?? undefined}
            profileName={
              previewPage?.pageUsername ?? previewPage?.pageName ?? undefined
            }
            className="w-56"
          />
          <p className="mt-2 text-xs text-muted-foreground">Live preview</p>
        </div>

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
                disabled={!fieldsEditable}
                aria-invalid={fieldState.invalid}
              />
              {fieldState.error && <FieldError errors={[fieldState.error]} />}
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
                rows={4}
                disabled={!fieldsEditable}
              />
            </Field>
          )}
        />

        {/* Assigned page — read-only */}
        <Field>
          <FieldLabel>Assigned page</FieldLabel>
          <Input value={assignedPagesLabel} disabled readOnly />
          <p className="text-xs text-muted-foreground">
            The page a post publishes to can&apos;t be changed here.
          </p>
        </Field>

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
                    field.onChange(date ? format(date, 'yyyy-MM-dd') : '')
                  }
                  disabled={!scheduleEditable}
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.error && <FieldError errors={[fieldState.error]} />}
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
                  id={field.name}
                  type="time"
                  disabled={!scheduleEditable}
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.error && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />
        </div>
        {!scheduleEditable && (
          <p className="-mt-3 text-xs text-muted-foreground">
            Only posts scheduled for a future time can be rescheduled.
          </p>
        )}

        {/* Platforms — read-only */}
        {platforms.length > 0 && (
          <Field>
            <FieldLabel>Platforms</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {platforms.map((p) => {
                const Icon = PLATFORM_ICONS[p];
                return (
                  <div
                    key={p}
                    className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm"
                  >
                    {Icon && (
                      <Icon
                        className={
                          p === 'facebook'
                            ? 'size-4 text-blue-600'
                            : 'size-4 text-pink-600'
                        }
                      />
                    )}
                    {PLATFORM_LABELS[p]}
                  </div>
                );
              })}
            </div>
          </Field>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t p-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={post.status === 'publishing' || isDeleting}
          onClick={() => setShowDeleteConfirm(true)}
        >
          <Trash2Icon className="size-4" />
          Delete
        </Button>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={!fieldsEditable || !form.formState.isDirty || isUpdating}
          >
            {isUpdating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <SaveIcon className="size-4" />
            )}
            {isUpdating ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </div>

      <ConfirmDeleteDialog
        description="The post is permanently deleted. This action cannot be undone."
        isPending={isDeleting}
        onConfirm={() => {
          // Failures (e.g. a 409 "currently publishing") are toasted by the
          // mutation's onError; swallow the rejection so it isn't an unhandled
          // promise rejection (ENG-256 / WEB-10).
          void deleteSocialPostAsync(post.id).catch(() => {});
        }}
        onOpenChange={setShowDeleteConfirm}
        open={showDeleteConfirm}
        title={<>Delete &ldquo;{post.title}&rdquo;?</>}
      />
    </form>
  );
}
