import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { format, isFuture, parse, parseISO } from 'date-fns';
import { ImageIcon, Trash2, VideoIcon } from 'lucide-react';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { DatePicker } from '@/components/ui/date-picker';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useActiveOrganization } from '@/features/organization/api/get-active-organization';
import {
  useDeleteSocialPost,
  useGetSocialPost,
  useUpdateSocialPost,
} from '@/features/social-posts';
import {
  type UpdateSocialPostFormValues,
  updateSocialPostForm,
} from '@/features/social-posts/api';
import { isSocialPostEditable } from '@/features/social-posts/social-post-lifecycle';
import { zonedEvent } from '@/lib/timezone';
import { useResolvedRoutes } from '@/lib/use-routes';

import { MobileTopBar } from './mobile-top-bar';

/**
 * Schema, defaults and labels all come from the ONE shared declaration every
 * edit-social-post surface renders from.
 *
 * This screen used to hold a lone `useState` caption box: `title` and the
 * schedule were in the update schema and in the payload builder, and the desktop
 * panel let you edit both — but here there was no control for either, so from a
 * phone you simply could not rename or reschedule a post. Nothing caught it,
 * because a payload-level test only ever sees the fields a surface DOES send.
 * The controls are restored, mirroring the panel, and the form contract now
 * fails if one goes missing again.
 */
const L = updateSocialPostForm.labels;

type FormData = UpdateSocialPostFormValues;

const MOBILE_INPUT_CLASS =
  'h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-800 focus:outline-none disabled:opacity-60';

interface SocialsMobilePostDetailProps {
  postId: string;
}

export function SocialsMobilePostDetail({
  postId,
}: SocialsMobilePostDetailProps) {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const { post, isLoading } = useGetSocialPost({ id: postId });
  const { data: organization } = useActiveOrganization();
  const timeZone = organization?.timezone ?? 'UTC';

  const { updateSocialPostAsync, isUpdating } = useUpdateSocialPost();
  const { deleteSocialPostAsync, isDeleting } = useDeleteSocialPost({
    onSuccess: () => {
      navigate({ to: routes.contentCalendar });
    },
  });

  const scheduledDate = post?.scheduledAt ? parseISO(post.scheduledAt) : null;
  // Same rules as the desktop panel: immutable API states cannot be edited, and
  // the schedule can only change while the post is still pending and in future.
  const fieldsEditable = isSocialPostEditable(post?.status);
  const scheduleEditable =
    !!post &&
    post.status !== 'publishing' &&
    post.status !== 'published' &&
    post.status !== 'partial' &&
    !!scheduledDate &&
    isFuture(scheduledDate);

  const form = useForm<FormData>({
    resolver: zodResolver(updateSocialPostForm.schema),
    defaultValues: updateSocialPostForm.defaults,
  });

  // Read during render so react-hook-form's formState proxy actually subscribes
  // to `isDirty` — read only inside the submit handler it stays permanently
  // false, and every save would be swallowed as "no changes".
  const { isDirty } = form.formState;

  const { reset } = form;
  // The post arrives async; seed the form once it lands.
  useEffect(() => {
    if (!post) return;
    // Seed the pickers with the stored instant's wall-clock in the BUSINESS
    // zone, so what the user edits matches how the update hook converts it back.
    const at = post.scheduledAt ? zonedEvent(post.scheduledAt, timeZone) : null;
    reset({
      ...updateSocialPostForm.defaults,
      title: post.title,
      caption: post.caption ?? '',
      date: at ? format(at, 'yyyy-MM-dd') : '',
      time: at ? format(at, 'HH:mm') : '',
    });
  }, [post, reset, timeZone]);

  const handleSave = async (data: FormData) => {
    if (!post) return;
    if (!isDirty) {
      toast.info('No changes to save');
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

  const handleDelete = async () => {
    if (!post) return;
    // Failures (e.g. a 409 "currently publishing") are toasted by the
    // mutation's onError; swallow the rejection so it isn't an unhandled
    // promise rejection (ENG-256 / WEB-10).
    try {
      await deleteSocialPostAsync(post.id);
    } catch {
      // Already toasted by the mutation's onError.
    }
  };

  const thumb = post?.thumbnailUrl ?? post?.mediaUrl ?? null;
  const isVideo = post?.mediaType === 'video';

  return (
    <div className="flex min-h-full flex-col bg-[#fafafa] pb-8">
      <MobileTopBar title="Recent Posts" />

      <form
        onSubmit={form.handleSubmit(handleSave)}
        className="flex flex-col gap-4 px-5 pt-6"
      >
        <p className="text-sm text-slate-500">{isVideo ? 'Video' : 'Image'}</p>

        {isLoading ? (
          <Skeleton className="aspect-square w-full rounded-3xl" />
        ) : thumb ? (
          <div className="aspect-square overflow-hidden rounded-3xl border border-slate-200 bg-slate-100">
            {isVideo && post?.mediaUrl ? (
              // biome-ignore lint/a11y/useMediaCaption: User content preview
              <video
                src={post.mediaUrl}
                poster={post.thumbnailUrl ?? undefined}
                className="size-full object-cover"
                controls
                playsInline
              />
            ) : (
              <img
                src={thumb}
                alt={post?.title ?? 'Post media'}
                className="size-full object-cover"
              />
            )}
          </div>
        ) : (
          <div className="flex aspect-square w-full items-center justify-center rounded-3xl border border-slate-200 bg-slate-100">
            {isVideo ? (
              <VideoIcon className="size-12 text-slate-400" />
            ) : (
              <ImageIcon className="size-12 text-slate-400" />
            )}
          </div>
        )}

        <Controller
          name="title"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel
                htmlFor={field.name}
                className="text-sm text-slate-500"
              >
                {L.title}
              </FieldLabel>
              <Input
                {...field}
                id={field.name}
                placeholder="Enter post title"
                disabled={isLoading || !fieldsEditable}
                aria-invalid={fieldState.invalid}
                className={MOBILE_INPUT_CLASS}
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
              <FieldLabel
                htmlFor={field.name}
                className="text-sm text-slate-500"
              >
                {L.caption}
              </FieldLabel>
              <Textarea
                {...field}
                id={field.name}
                rows={5}
                disabled={isLoading || !fieldsEditable}
                placeholder="Write a caption..."
                className="min-h-[107px] w-full rounded-md border border-slate-300 bg-white p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-800 focus:outline-none disabled:opacity-60"
              />
            </Field>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <Controller
            name="date"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel
                  htmlFor={field.name}
                  className="text-sm text-slate-500"
                >
                  {L.date}
                </FieldLabel>
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
                  disabled={isLoading || !scheduleEditable}
                  aria-invalid={fieldState.invalid}
                  className={MOBILE_INPUT_CLASS}
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
                <FieldLabel
                  htmlFor={field.name}
                  className="text-sm text-slate-500"
                >
                  {L.time}
                </FieldLabel>
                <Input
                  {...field}
                  id={field.name}
                  type="time"
                  disabled={isLoading || !scheduleEditable}
                  aria-invalid={fieldState.invalid}
                  className={MOBILE_INPUT_CLASS}
                />
                {fieldState.error && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />
        </div>
        {!scheduleEditable && !isLoading && (
          <p className="-mt-2 text-xs text-slate-500">
            Only posts scheduled for a future time can be rescheduled.
          </p>
        )}

        <ConfirmDeleteDialog
          confirmLabel="Delete post"
          description="The post is permanently deleted. This cannot be undone."
          isPending={isDeleting}
          onConfirm={() => void handleDelete()}
          title={<>Delete &ldquo;{post?.title || 'this post'}&rdquo;?</>}
          trigger={
            <button
              className="flex h-10 w-full items-center justify-center gap-2.5 rounded-[10px] bg-red-600 px-5 text-base font-medium text-white shadow-sm active:opacity-80 disabled:opacity-50"
              disabled={isDeleting || isLoading || !post}
              type="button"
            >
              <Trash2 className="size-5" />
              {isDeleting ? 'Deleting…' : 'Delete Post'}
            </button>
          }
        />

        <button
          type="submit"
          disabled={isUpdating || isLoading || !fieldsEditable}
          className="flex h-11 w-full items-center justify-center rounded-md border border-slate-300 bg-slate-200 px-3 text-base text-slate-900 active:opacity-80 disabled:opacity-50"
        >
          {isUpdating ? 'Saving…' : 'Save Post'}
        </button>
      </form>
    </div>
  );
}
