import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useListSocialPosts } from '@/features/social-posts';
import { cn } from '@/lib/utils';
import { Check, ImageIcon, Search, VideoIcon } from 'lucide-react';
import { useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { useAdWizard } from '../../-context';
import type { SelectedPost } from '../../-context';
import type { AdWizardFormData } from '../../-schema';

export function SelectPostStep() {
  const { setValue, watch, formState } = useFormContext<AdWizardFormData>();
  const { setSelectedPost } = useAdWizard();
  const [search, setSearch] = useState('');

  const selectedId = watch('socialPostId');
  const adName = watch('adName');

  const { posts, isLoading } = useListSocialPosts({
    filters: { status: 'published', search: search || undefined, limit: 50 },
  });

  const handleSelectPost = (post: {
    id: string;
    title: string;
    caption: string | null;
    mediaType: string;
    mediaUrl: string;
    thumbnailUrl: string | null;
    platforms: unknown;
  }) => {
    setValue('socialPostId', post.id);
    if (!adName) {
      setValue('adName', post.title);
    }

    const platforms = Array.isArray(post.platforms)
      ? (post.platforms as string[])
      : [];

    const selected: SelectedPost = {
      id: post.id,
      title: post.title,
      caption: post.caption,
      mediaType: post.mediaType,
      mediaUrl: post.mediaUrl,
      thumbnailUrl: post.thumbnailUrl,
      platforms,
    };

    setSelectedPost(selected);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">
          Select a published post
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a post to use as your ad creative. The post&apos;s content will
          be used as-is.
        </p>
      </div>

      {/* Ad Name */}
      <div className="space-y-2">
        <label htmlFor="adName" className="text-sm font-medium">
          Ad Name
        </label>
        <Input
          id="adName"
          placeholder="Name your ad"
          value={adName || ''}
          onChange={(e) => setValue('adName', e.target.value)}
          aria-invalid={!!formState.errors.adName}
        />
        {formState.errors.adName && (
          <p className="text-sm text-destructive">
            {formState.errors.adName.message}
          </p>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search posts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Post Grid */}
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
          <p className="font-medium">No published posts found</p>
          <p className="mt-1 text-sm">
            Publish a post from the content calendar first.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {posts.map((post) => {
            const isSelected = selectedId === post.id;
            const platforms = Array.isArray(post.platforms)
              ? (post.platforms as string[])
              : [];

            return (
              <button
                key={post.id}
                type="button"
                onClick={() => handleSelectPost(post)}
                className={cn(
                  'relative flex gap-3 rounded-xl border-2 p-3 text-left transition-all',
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                )}
              >
                {/* Thumbnail */}
                <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
                  {post.thumbnailUrl || post.mediaUrl ? (
                    <img
                      src={post.thumbnailUrl || post.mediaUrl}
                      alt={post.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      {post.mediaType === 'video' ? (
                        <VideoIcon className="h-6 w-6 text-muted-foreground" />
                      ) : (
                        <ImageIcon className="h-6 w-6 text-muted-foreground" />
                      )}
                    </div>
                  )}
                  {isSelected && (
                    <div className="absolute inset-0 flex items-center justify-center bg-primary/20">
                      <Check className="h-6 w-6 text-primary" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{post.title}</p>
                  {post.caption && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {post.caption}
                    </p>
                  )}
                  <div className="mt-1.5 flex gap-1">
                    {platforms.map((p) => (
                      <Badge
                        key={p}
                        variant="secondary"
                        className="text-[10px]"
                      >
                        {p}
                      </Badge>
                    ))}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {formState.errors.socialPostId && (
        <p className="text-sm text-destructive">
          {formState.errors.socialPostId.message}
        </p>
      )}
    </div>
  );
}
