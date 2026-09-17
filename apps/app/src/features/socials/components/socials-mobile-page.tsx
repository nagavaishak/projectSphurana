import { format, parseISO } from 'date-fns';
import { CalendarDays, ChevronRight, ImageIcon, List } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';

import { MobilePageShell } from '@/components/app/mobile-page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type Asset, useListAssets } from '@/features/assets';
import { GalleryPageContent } from '@/features/content-studio/gallery-page-content';
import { type SocialPost, useListSocialPosts } from '@/features/social-posts';

import { BulkCreateButton } from './bulk-create-button';
import { useGeneratedContentTiles } from './generated-content-card';
import { MediaThumb } from './media-thumb';
import { NewPostButton } from './new-post-button';
import { PlannerCalendar } from './planner-calendar';
import { PlannerList } from './planner-list';

type MobileView = 'hub' | 'planner' | 'gallery';

/**
 * Mobile socials screen: a hub of two equal halves (Planner / Gallery), each a
 * live preview of its content. Tapping either opens a full-page view that
 * renders the exact same component the web uses, with a back control in the
 * shared header to return to the hub.
 */
export function SocialsMobilePage() {
  const [view, setView] = useState<MobileView>('hub');

  if (view === 'planner') {
    return <PlannerView onBack={() => setView('hub')} />;
  }
  if (view === 'gallery') {
    return <GalleryView onBack={() => setView('hub')} />;
  }
  return (
    <SocialsHub
      onOpenPlanner={() => setView('planner')}
      onOpenGallery={() => setView('gallery')}
    />
  );
}

function SocialsHub({
  onOpenPlanner,
  onOpenGallery,
}: {
  onOpenPlanner: () => void;
  onOpenGallery: () => void;
}) {
  return (
    <MobilePageShell contentClassName="px-4 pb-5" tabRoot title="Socials">
      <div className="flex flex-col gap-4">
        <PlannerPreviewTile onClick={onOpenPlanner} />
        <GalleryPreviewTile onClick={onOpenGallery} />
      </div>
    </MobilePageShell>
  );
}

/** Tappable half-screen card with a header and a content preview underneath. */
function PreviewTile({
  title,
  description,
  icon,
  onClick,
  children,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[40vh] flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left active:opacity-90"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-full bg-slate-800/5">
            {icon}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">{title}</p>
            <p className="text-[11px] text-slate-500">{description}</p>
          </div>
        </div>
        <ChevronRight className="size-4 text-slate-400" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-3">{children}</div>
    </button>
  );
}

function PlannerPreviewTile({ onClick }: { onClick: () => void }) {
  const { posts, isLoading } = useListSocialPosts({ filters: { limit: 30 } });

  const previewPosts = useMemo(() => {
    const upcoming = posts
      .filter((p) => p.status === 'scheduled' || p.status === 'publishing')
      .sort((a, b) =>
        (a.scheduledAt ?? a.createdAt).localeCompare(
          b.scheduledAt ?? b.createdAt
        )
      );
    if (upcoming.length > 0) return upcoming.slice(0, 4);
    return posts
      .filter((p) => p.status === 'published')
      .sort((a, b) =>
        (b.publishedAt ?? b.createdAt).localeCompare(
          a.publishedAt ?? a.createdAt
        )
      )
      .slice(0, 4);
  }, [posts]);

  return (
    <PreviewTile
      title="Planner"
      description="Create and schedule your posts"
      icon={<CalendarDays className="size-5 text-slate-700" />}
      onClick={onClick}
    >
      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full rounded-lg" />
          ))}
        </div>
      ) : previewPosts.length === 0 ? (
        <PreviewEmpty text="No posts yet — tap to create one" />
      ) : (
        <ul className="flex flex-col gap-2">
          {previewPosts.map((post) => (
            <PostPreviewRow key={post.id} post={post} />
          ))}
        </ul>
      )}
    </PreviewTile>
  );
}

function PostPreviewRow({ post }: { post: SocialPost }) {
  const caption = post.caption?.trim() || post.title;
  const dateStr = post.scheduledAt ?? post.publishedAt ?? post.createdAt;
  const dateLabel = dateStr ? format(parseISO(dateStr), 'MMM d, h:mma') : '';

  return (
    <li className="flex items-center gap-2.5">
      <div className="size-11 flex-shrink-0 overflow-hidden rounded-lg">
        <MediaThumb
          type={post.mediaType === 'video' ? 'video' : 'image'}
          url={post.mediaUrl}
          thumbnailUrl={post.thumbnailUrl}
          alt={post.title}
          showPlayBadge={false}
          iconClassName="size-4"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 text-xs font-medium text-slate-800">
          {caption}
        </p>
        {dateLabel && <p className="text-[10px] text-slate-500">{dateLabel}</p>}
      </div>
    </li>
  );
}

interface PreviewMedia {
  key: string;
  type: 'image' | 'video';
  url: string | null;
  thumbnailUrl: string | null;
  alt: string;
}

function assetToMedia(asset: Asset): PreviewMedia {
  const isVideo = asset.type === 'video';
  return {
    key: `asset-${asset.id}`,
    type: isVideo ? 'video' : 'image',
    url: asset.blobUrl,
    thumbnailUrl: asset.thumbnailUrl ?? null,
    alt: asset.name,
  };
}

function GalleryPreviewTile({ onClick }: { onClick: () => void }) {
  const { assets, isLoading: assetsLoading } = useListAssets({ limit: 12 });
  const { tiles, isLoading: generatedLoading } = useGeneratedContentTiles();

  const isLoading = assetsLoading || generatedLoading;

  const media = useMemo<PreviewMedia[]>(() => {
    const generated: PreviewMedia[] = tiles.map((t) => ({
      key: t.key,
      type: t.type,
      url: t.url,
      thumbnailUrl: t.thumbnailUrl,
      alt: t.alt,
    }));
    return [...assets.map(assetToMedia), ...generated].slice(0, 6);
  }, [assets, tiles]);

  return (
    <PreviewTile
      title="Gallery"
      description="Your uploaded and generated content"
      icon={<ImageIcon className="size-5 text-slate-700" />}
      onClick={onClick}
    >
      {isLoading ? (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-md" />
          ))}
        </div>
      ) : media.length === 0 ? (
        <PreviewEmpty text="No content yet — tap to add some" />
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {media.map((item) => (
            <div
              key={item.key}
              className="aspect-square overflow-hidden rounded-md bg-muted"
            >
              <MediaThumb
                type={item.type}
                url={item.url}
                thumbnailUrl={item.thumbnailUrl}
                alt={item.alt}
                iconClassName="size-5"
              />
            </div>
          ))}
        </div>
      )}
    </PreviewTile>
  );
}

function PreviewEmpty({ text }: { text: string }) {
  return (
    <div className="flex h-full min-h-24 items-center justify-center px-4 text-center text-xs text-slate-400">
      {text}
    </div>
  );
}

/** Same planner the web shows (List + Calendar tabs). */
function PlannerView({ onBack }: { onBack: () => void }) {
  return (
    <Tabs className="contents" defaultValue="list">
      <MobilePageShell
        action={
          <div className="flex items-center gap-2">
            <BulkCreateButton />
            <NewPostButton />
          </div>
        }
        contentClassName="px-4 pb-6"
        onBack={onBack}
        title="Planner"
        toolbar={
          <TabsList>
            <TabsTrigger value="list">
              <List className="size-4" />
              List
            </TabsTrigger>
            <TabsTrigger value="calendar">
              <CalendarDays className="size-4" />
              Calendar
            </TabsTrigger>
          </TabsList>
        }
      >
        <TabsContent value="list">
          <PlannerList />
        </TabsContent>
        <TabsContent value="calendar">
          <PlannerCalendar />
        </TabsContent>
      </MobilePageShell>
    </Tabs>
  );
}

/** Same gallery the web shows. */
function GalleryView({ onBack }: { onBack: () => void }) {
  return (
    <MobilePageShell
      contentClassName="px-4 pb-6"
      onBack={onBack}
      title="Gallery"
    >
      <GalleryPageContent />
    </MobilePageShell>
  );
}
