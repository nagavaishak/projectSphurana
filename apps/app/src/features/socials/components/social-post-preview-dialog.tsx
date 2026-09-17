import { format, formatDistanceToNow, parseISO } from 'date-fns';
import {
  CalendarClock,
  CheckCircle2,
  FacebookIcon,
  FileEdit,
  ImageIcon,
  InstagramIcon,
  Send,
  VideoIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useGetGraphic } from '@/features/graphics';
import type {
  SocialPost,
  SocialPostPlatform,
  SocialPostStatus,
} from '@/features/social-posts';
import { cn } from '@/lib/utils';

import {
  GraphicSlideCarousel,
  readyGraphicOutputs,
} from './graphic-slide-carousel';

const PLATFORM_ICONS: Record<SocialPostPlatform, typeof FacebookIcon> = {
  facebook: FacebookIcon,
  instagram: InstagramIcon,
};

const PLATFORM_LABELS: Record<SocialPostPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
};

const STATUS_LABELS: Record<SocialPostStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  publishing: 'Publishing',
  published: 'Published',
  partial: 'Partially published',
  failed: 'Failed',
};

const STATUS_ICONS: Record<SocialPostStatus, typeof CheckCircle2> = {
  draft: FileEdit,
  scheduled: CalendarClock,
  publishing: Send,
  published: CheckCircle2,
  partial: CheckCircle2,
  failed: FileEdit,
};

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

export interface SocialPostPreviewDialogProps {
  post: SocialPost | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SocialPostPreviewDialog({
  post,
  open,
  onOpenChange,
}: SocialPostPreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        {post ? <PostPreviewBody post={post} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PostPreviewBody({ post }: { post: SocialPost }) {
  const platforms = Array.isArray(post.platforms)
    ? (post.platforms as SocialPostPlatform[])
    : [];
  const isVideo = post.mediaType === 'video';
  const StatusIcon = STATUS_ICONS[post.status];

  // Carousel graphics keep only slide 0 in `mediaUrl`; the rest live on the
  // linked graphic. Load it so all slides are scrollable in the preview.
  const { graphic } = useGetGraphic(post.graphicId ?? '');
  const hasCarousel =
    !!post.graphicId && readyGraphicOutputs(graphic).length > 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {post.title}
          <Badge
            variant={STATUS_VARIANTS[post.status]}
            className="gap-1 text-xs"
          >
            <StatusIcon className="size-3" />
            {STATUS_LABELS[post.status]}
          </Badge>
        </DialogTitle>
        <DialogDescription>
          <TimingLabel post={post} />
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {hasCarousel ? (
          <GraphicSlideCarousel graphic={graphic} aspectRatio="1 / 1" />
        ) : (
          <div className="overflow-hidden rounded-md bg-muted">
            {isVideo ? (
              // biome-ignore lint/a11y/useMediaCaption: user-generated social posts don't carry captions today; track support is a follow-up
              <video
                src={post.mediaUrl}
                poster={post.thumbnailUrl ?? undefined}
                controls
                className="aspect-square size-full object-contain bg-black"
              />
            ) : post.mediaUrl ? (
              <img
                src={post.mediaUrl}
                alt={post.title}
                className="aspect-square size-full object-contain"
              />
            ) : (
              <div className="flex aspect-square items-center justify-center text-muted-foreground">
                {isVideo ? (
                  <VideoIcon className="size-10" />
                ) : (
                  <ImageIcon className="size-10" />
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {platforms.map((p) => {
              const Icon = PLATFORM_ICONS[p];
              if (!Icon) return null;
              return (
                <Badge
                  key={p}
                  variant="secondary"
                  className="gap-1 px-2 py-0.5 text-xs"
                >
                  <Icon
                    className={cn(
                      'size-3',
                      p === 'facebook' ? 'text-blue-600' : 'text-pink-600'
                    )}
                  />
                  {PLATFORM_LABELS[p]}
                </Badge>
              );
            })}
          </div>

          {post.caption ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {post.caption}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No caption set
            </p>
          )}
        </div>
      </div>
    </>
  );
}

function TimingLabel({ post }: { post: SocialPost }) {
  if (post.status === 'published' && post.publishedAt) {
    const date = parseISO(post.publishedAt);
    if (Number.isNaN(date.getTime())) return null;
    return (
      <>
        Published {formatDistanceToNow(date, { addSuffix: true })} ·{' '}
        {format(date, 'PPp')}
      </>
    );
  }
  if (post.scheduledAt) {
    const date = parseISO(post.scheduledAt);
    if (Number.isNaN(date.getTime())) return null;
    const isPast = date.getTime() < Date.now();
    return (
      <>
        {isPast ? 'Was due' : 'Scheduled for'} {format(date, 'PPp')} ·{' '}
        {isPast
          ? formatDistanceToNow(date, { addSuffix: true })
          : `in ${formatDistanceToNow(date)}`}
      </>
    );
  }
  return null;
}
