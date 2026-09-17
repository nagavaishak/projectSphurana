import { Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { useListMetaAdsPages } from '@/features/integrations';
import { type SocialPost, useListSocialPosts } from '@/features/social-posts';

import { MobileTopBar } from './mobile-top-bar';
import { PagePills } from './page-pills';
import { PostRow } from './post-row';
import { postTargetsPage } from './post-targets-page';

interface SocialsMobilePostsListProps {
  title: string;
  variant: 'recent' | 'scheduled';
}

/**
 * Full-page list of either recent (published) or scheduled posts.
 * Matches Figma "Recent Posts" screen.
 */
export function SocialsMobilePostsList({
  title,
  variant,
}: SocialsMobilePostsListProps) {
  const [selectedPageId, setSelectedPageId] = useState<string | 'all'>('all');
  const [search, setSearch] = useState('');

  const filters = useMemo(
    () => ({ search: search || undefined, limit: 100 }),
    [search]
  );

  const { pages, isLoading: isPagesLoading } = useListMetaAdsPages();
  const { posts: allPosts, isLoading } = useListSocialPosts({ filters });

  const selectedPage = useMemo(
    () => pages.find((p) => p.id === selectedPageId) ?? null,
    [pages, selectedPageId]
  );

  const filtered = useMemo(() => {
    const wanted =
      variant === 'recent'
        ? (p: SocialPost) => p.status === 'published'
        : (p: SocialPost) =>
            p.status === 'scheduled' || p.status === 'publishing';
    let result = allPosts.filter(wanted);
    if (selectedPage) {
      result = result.filter((p) => postTargetsPage(p, selectedPage));
    }
    if (variant === 'scheduled') {
      result.sort((a, b) => {
        const aDate = a.scheduledAt ?? a.createdAt;
        const bDate = b.scheduledAt ?? b.createdAt;
        return aDate.localeCompare(bDate);
      });
    }
    return result;
  }, [allPosts, selectedPage, variant]);

  return (
    <div className="flex min-h-full flex-col bg-[#fafafa] pb-8">
      <MobileTopBar title={title} />

      <div className="flex flex-col gap-3 px-5 pt-2">
        <PagePills
          pages={pages}
          isLoading={isPagesLoading}
          value={selectedPageId}
          onChange={setSelectedPageId}
        />

        <div className="flex items-center gap-4">
          <div className="relative flex h-9 flex-1 items-center rounded-md border border-slate-800 bg-white pl-3 pr-2 shadow-sm">
            <Search className="size-4 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your posts..."
              className="flex-1 bg-transparent px-2 text-sm placeholder:text-slate-500 focus:outline-none"
            />
          </div>
          <button
            type="button"
            className="flex size-9 items-center justify-center rounded-full bg-slate-800 text-white shadow-sm active:opacity-80"
            aria-label="New post"
          >
            <Plus className="size-4" />
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white">
          {isLoading ? (
            <div className="space-y-3 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-md" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-400">
              {variant === 'recent'
                ? 'No published posts in range.'
                : 'Nothing scheduled.'}
            </div>
          ) : (
            <ul>
              {filtered.map((post) => (
                <li key={post.id}>
                  <PostRow post={post} variant={variant} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
