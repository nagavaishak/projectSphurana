import { useResolvedRoutes } from '@/lib/use-routes';
import { Link } from '@tanstack/react-router';
import { formatDistanceToNow, parseISO } from 'date-fns';
import {
  FacebookIcon,
  Heart,
  ImageIcon,
  InstagramIcon,
  MessageCircle,
  MoreHorizontal,
  VideoIcon,
} from 'lucide-react';

import { useActiveOrganization } from '@/features/organization';
import type { SocialPost, SocialPostPlatform } from '@/features/social-posts';

const PLATFORM_ICONS = {
  facebook: FacebookIcon,
  instagram: InstagramIcon,
} as const;

interface PostRowProps {
  post: SocialPost;
  variant: 'recent' | 'scheduled';
}

/**
 * One row in the mobile Recent/Scheduled list. Tappable, navigates to detail.
 */
export function PostRow({ post, variant }: PostRowProps) {
  const routes = useResolvedRoutes();
  const thumb = post.thumbnailUrl ?? post.mediaUrl;
  const caption = post.caption?.trim() || post.title;
  const platforms = Array.isArray(post.platforms)
    ? (post.platforms as SocialPostPlatform[])
    : [];

  return (
    <Link
      to={routes.socialPost(post.id)}
      params={{ id: post.id }}
      className="flex items-center gap-1.5 border-b border-slate-200 px-3.5 py-2.5 last:border-b-0 active:bg-slate-50"
    >
      <div className="size-[46.59px] flex-shrink-0 overflow-hidden rounded-lg bg-pink-50">
        {thumb ? (
          <img
            src={thumb}
            alt={post.title}
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-slate-400">
            {post.mediaType === 'video' ? (
              <VideoIcon className="size-5" />
            ) : (
              <ImageIcon className="size-5" />
            )}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[12px] leading-[16.8px] font-medium text-slate-800">
          {caption}
        </p>
        {variant === 'recent' ? (
          <RecentMeta post={post} />
        ) : (
          <ScheduledMeta post={post} />
        )}
      </div>
      <RightDecoration variant={variant} platforms={platforms} post={post} />
    </Link>
  );
}

function RecentMeta({ post }: { post: SocialPost }) {
  // Engagement counters: prefer cached numbers off the post itself if available
  // (the backend may surface them in metadata). Fall back to dashes.
  const m = (
    post as { metrics?: { likes?: number; comments?: number; views?: number } }
  ).metrics;
  const fmt = (n?: number) =>
    n == null ? null : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
  const likes = fmt(m?.likes);
  const comments = fmt(m?.comments);
  const views = fmt(m?.views);

  if (!likes && !comments && !views) return null;
  return (
    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
      {likes != null && (
        <span className="flex items-center gap-0.5">
          <Heart className="size-2.5" /> {likes}
        </span>
      )}
      {comments != null && (
        <span className="flex items-center gap-0.5">
          <MessageCircle className="size-2.5" /> {comments}
        </span>
      )}
      {views != null && (
        <span className="flex items-center gap-0.5">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-2.5"
            role="img"
            aria-label="Views"
          >
            <title>Views</title>
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          {views}
        </span>
      )}
    </div>
  );
}

function ScheduledMeta({ post }: { post: SocialPost }) {
  // A scheduled send is a BUSINESS event — the time the post goes out for the
  // business — so it renders in the org's timezone, not the viewer's device.
  // Hook must run before any early return.
  const { data: organization } = useActiveOrganization();
  const timeZone = organization?.timezone ?? 'UTC';

  if (!post.scheduledAt) return null;
  const target = parseISO(post.scheduledAt);
  if (Number.isNaN(target.getTime())) return null;
  const label = target.toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  });
  return <p className="mt-0.5 text-[11px] text-slate-500">{label}</p>;
}

function RightDecoration({
  variant,
  platforms,
  post,
}: {
  variant: 'recent' | 'scheduled';
  platforms: SocialPostPlatform[];
  post: SocialPost;
}) {
  if (variant === 'scheduled') {
    return <MoreHorizontal className="size-5 text-slate-400" />;
  }

  // Recent: show platform icon stack + time ago
  const timeLabel = post.publishedAt
    ? `${formatDistanceToNow(parseISO(post.publishedAt), { addSuffix: false }).replace(/^about /, '')} ago`
    : null;

  return (
    <div className="flex items-center gap-2.5">
      <div className="flex -space-x-2">
        {platforms.map((p) => {
          const Icon = PLATFORM_ICONS[p];
          if (!Icon) return null;
          return (
            <div
              key={p}
              className="flex size-[17px] items-center justify-center rounded-full bg-white ring-1 ring-slate-200"
            >
              <Icon
                className={
                  p === 'facebook'
                    ? 'size-3 text-blue-600'
                    : 'size-3 text-pink-600'
                }
              />
            </div>
          );
        })}
      </div>
      {timeLabel && (
        <span className="text-[11px] text-slate-400 whitespace-nowrap">
          {timeLabel}
        </span>
      )}
    </div>
  );
}
