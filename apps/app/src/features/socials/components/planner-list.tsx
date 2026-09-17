import { Link } from '@tanstack/react-router';
import {
  endOfWeek,
  format,
  isSameMonth,
  isSameYear,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import {
  CalendarIcon,
  FacebookIcon,
  InstagramIcon,
  Loader2,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useSidePanel } from '@/components/app/side-panel';
import { StateEmpty } from '@/components/app/state-empty';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { SingleCalendar } from '@/components/ui/single-calendar';
import { Skeleton } from '@/components/ui/skeleton';
import { type MetaAdsPage, useListMetaAdsPages } from '@/features/integrations';
import {
  type SocialPost,
  SocialPostPanel,
  type SocialPostPlatform,
  useDeleteSocialPost,
  useListSocialPosts,
} from '@/features/social-posts';
import { useIsMobile } from '@/hooks/use-mobile';
import { useResolvedRoutes } from '@/lib/use-routes';
import { cn } from '@/lib/utils';

import { MediaThumb } from './media-thumb';

const PLATFORM_ICONS: Record<SocialPostPlatform, typeof FacebookIcon> = {
  facebook: FacebookIcon,
  instagram: InstagramIcon,
};

/** The date a post sits at in the planner — its scheduled slot, else created. */
function postDate(post: SocialPost): Date {
  return parseISO(post.scheduledAt ?? post.createdAt);
}

/** First page whose platform this post targets — used for avatar + label. */
function pageForPost(
  post: SocialPost,
  pages: MetaAdsPage[]
): MetaAdsPage | null {
  const platforms = Array.isArray(post.platforms)
    ? (post.platforms as SocialPostPlatform[])
    : [];
  return pages.find((p) => platforms.includes(p.platform)) ?? null;
}

interface Section {
  key: string;
  label: string;
  posts: SocialPost[];
}

/** A section is broken into a finer grain once it holds more than this many. */
const MAX_PER_SECTION = 10;

/** "6 – 12 May 2024" / "29 Apr – 5 May 2024" / cross-year variant. */
function formatWeekRange(weekStart: Date): string {
  const weekEnd = endOfWeek(weekStart);
  if (isSameMonth(weekStart, weekEnd)) {
    return `${format(weekStart, 'd')} – ${format(weekEnd, 'd MMM yyyy')}`;
  }
  if (isSameYear(weekStart, weekEnd)) {
    return `${format(weekStart, 'd MMM')} – ${format(weekEnd, 'd MMM yyyy')}`;
  }
  return `${format(weekStart, 'd MMM yyyy')} – ${format(weekEnd, 'd MMM yyyy')}`;
}

/** Group an already-sorted list by a key fn, preserving chronological order. */
function groupOrdered(
  posts: SocialPost[],
  keyFn: (post: SocialPost) => string
): SocialPost[][] {
  const map = new Map<string, SocialPost[]>();
  for (const post of posts) {
    const key = keyFn(post);
    const arr = map.get(key);
    if (arr) arr.push(post);
    else map.set(key, [post]);
  }
  return [...map.values()];
}

/**
 * Build the planner sections with adaptive granularity: start at month, drop to
 * weeks for any month over the cap, and drop to individual days for any week
 * still over the cap. `posts` must already be sorted ascending.
 */
function buildSections(posts: SocialPost[]): Section[] {
  const sections: Section[] = [];

  for (const monthPosts of groupOrdered(posts, (p) =>
    format(startOfMonth(postDate(p)), 'yyyy-MM')
  )) {
    if (monthPosts.length <= MAX_PER_SECTION) {
      const date = postDate(monthPosts[0]);
      sections.push({
        key: `m-${format(date, 'yyyy-MM')}`,
        label: format(date, 'MMMM yyyy'),
        posts: monthPosts,
      });
      continue;
    }

    for (const weekPosts of groupOrdered(monthPosts, (p) =>
      format(startOfWeek(postDate(p)), 'yyyy-MM-dd')
    )) {
      if (weekPosts.length <= MAX_PER_SECTION) {
        const weekStart = startOfWeek(postDate(weekPosts[0]));
        sections.push({
          key: `w-${format(weekStart, 'yyyy-MM-dd')}`,
          label: formatWeekRange(weekStart),
          posts: weekPosts,
        });
        continue;
      }

      for (const dayPosts of groupOrdered(weekPosts, (p) =>
        format(postDate(p), 'yyyy-MM-dd')
      )) {
        const date = postDate(dayPosts[0]);
        sections.push({
          key: `d-${format(date, 'yyyy-MM-dd')}`,
          label: format(date, 'EEEE d MMM yyyy'),
          posts: dayPosts,
        });
      }
    }
  }

  return sections;
}

/**
 * Chronological "List" view for the Planner. Posts are shown from a chosen
 * start date forward (ascending), grouped by month — with any month over 10
 * posts broken into weeks, and any week over 10 broken into days. The first
 * section's heading doubles as a date picker that controls where the list starts.
 */
/** Posts revealed per page; the first page loads automatically. */
const PAGE_SIZE = 15;

export function PlannerList() {
  // The list starts here and runs forward in time.
  const [anchor, setAnchor] = useState<Date>(() => startOfMonth(new Date()));
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filters = useMemo(
    () => ({ startDate: anchor.toISOString(), limit: 500 }),
    [anchor]
  );

  const { posts, isLoading } = useListSocialPosts({ filters });
  const { pages } = useListMetaAdsPages();

  const sortedPosts = useMemo(
    () =>
      [...posts].sort((a, b) => postDate(a).getTime() - postDate(b).getTime()),
    [posts]
  );

  // Reveal a page at a time. Changing the start date resets to the first page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset paging when the window changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [anchor]);

  const hasMore = visibleCount < sortedPosts.length;

  const sections = useMemo<Section[]>(
    () => buildSections(sortedPosts.slice(0, visibleCount)),
    [sortedPosts, visibleCount]
  );

  // Load the next page when the sentinel scrolls into view.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((count) => count + PAGE_SIZE);
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore]);

  return (
    <div className="flex flex-col gap-6">
      {isLoading ? (
        <ListSkeleton />
      ) : sections.length === 0 ? (
        <div className="flex flex-col gap-4">
          <SectionHeading
            label={format(anchor, 'MMMM yyyy')}
            anchor={anchor}
            onAnchorChange={setAnchor}
          />
          <StateEmpty
            icon={<CalendarIcon />}
            title="Nothing planned yet"
            description="Scheduled and published posts from this date onward will show up here."
          />
        </div>
      ) : (
        sections.map((section, index) => (
          <section key={section.key} className="flex flex-col gap-2">
            {index === 0 ? (
              <SectionHeading
                label={section.label}
                anchor={anchor}
                onAnchorChange={setAnchor}
              />
            ) : (
              <h3 className="text-base font-semibold">{section.label}</h3>
            )}
            <ul className="overflow-hidden rounded-lg border">
              {section.posts.map((post) => (
                <li key={post.id}>
                  <PlannerRow post={post} page={pageForPost(post, pages)} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {hasMore && (
        <div
          ref={sentinelRef}
          className="flex items-center justify-center py-4 text-muted-foreground"
        >
          <Loader2 className="size-5 animate-spin" />
        </div>
      )}
    </div>
  );
}

function SectionHeading({
  label,
  anchor,
  onAnchorChange,
}: {
  label: string;
  anchor: Date;
  onAnchorChange: (date: Date) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="-ml-1 inline-flex items-center gap-1.5 rounded-md px-1 text-base font-semibold transition-colors hover:bg-muted"
        >
          {label}
          <CalendarIcon className="size-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <SingleCalendar
          mode="single"
          selected={anchor}
          onSelect={(date) => {
            if (date) {
              onAnchorChange(date);
              setOpen(false);
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function PlannerRow({
  post,
  page,
}: {
  post: SocialPost;
  page: MetaAdsPage | null;
}) {
  const routes = useResolvedRoutes();
  const isMobile = useIsMobile();
  const { deleteSocialPost, isDeleting } = useDeleteSocialPost();
  const { open: openPanel } = useSidePanel();
  const showPanel = () => openPanel(<SocialPostPanel post={post} />);
  const date = postDate(post);
  const caption = post.caption?.trim() || post.title;
  const platforms = Array.isArray(post.platforms)
    ? (post.platforms as SocialPostPlatform[])
    : [];
  const badgeLabel =
    page?.pageName ?? (platforms[0] === 'instagram' ? 'Instagram' : 'Facebook');

  // The post's own media is the thumbnail. Images keep their URL in `mediaUrl`
  // (thumbnailUrl is null for them), so MediaThumb falls back to it; videos use
  // their poster. This is why the page-avatar approach showed nothing for most.
  const inner = (
    <>
      <div className="flex w-10 flex-shrink-0 flex-col items-center leading-none">
        <span className="text-[10px] font-medium uppercase text-muted-foreground">
          {format(date, 'EEE')}
        </span>
        <span className="text-base font-semibold tabular-nums">
          {format(date, 'dd')}
        </span>
      </div>

      <div className="size-9 flex-shrink-0 overflow-hidden rounded-md">
        <MediaThumb
          type={post.mediaType === 'video' ? 'video' : 'image'}
          url={post.mediaUrl}
          thumbnailUrl={post.thumbnailUrl}
          alt={post.title}
          showPlayBadge={false}
          iconClassName="size-4"
        />
      </div>

      <span className="w-12 flex-shrink-0 text-sm tabular-nums text-muted-foreground">
        {format(date, 'HH:mm')}
      </span>

      <Badge variant="secondary" className="flex-shrink-0 font-normal">
        {badgeLabel}
      </Badge>

      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        {caption}
      </span>
    </>
  );

  return (
    <div className="flex items-center gap-3 border-b px-3 py-2.5 transition-colors last:border-b-0 hover:bg-muted/40">
      {isMobile ? (
        <Link
          to={routes.socialPost(post.id)}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          {inner}
        </Link>
      ) : (
        <button
          type="button"
          onClick={showPanel}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {inner}
        </button>
      )}

      <div className="flex flex-shrink-0 items-center gap-1">
        {platforms.map((p) => {
          const Icon = PLATFORM_ICONS[p];
          if (!Icon) return null;
          return (
            <Icon
              key={p}
              className={cn(
                'size-3.5',
                p === 'facebook' ? 'text-blue-600' : 'text-pink-600'
              )}
            />
          );
        })}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              aria-label="Post actions"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {isMobile ? (
              <DropdownMenuItem asChild>
                <Link to={routes.socialPost(post.id)}>View details</Link>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={showPanel}>
                View details
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="destructive"
              disabled={isDeleting}
              onSelect={() => deleteSocialPost(post.id)}
            >
              <Trash2 className="size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-7 w-40" />
      <div className="overflow-hidden rounded-lg border">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b p-3 last:border-b-0"
          >
            <Skeleton className="size-9 rounded-full" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
