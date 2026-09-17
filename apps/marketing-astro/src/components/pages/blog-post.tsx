'use client';

import { MarketingShell } from '@/components/marketing-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RichText } from '@/features/blog/components/rich-text';
import {
  type CMSPost,
  formatDate,
  getCategoryFields,
  getImageAlt,
  getImageDimensions,
  getImageUrl,
  getTagFields,
  isEntry,
} from '@/features/blog/types';
import type { RuntimeConfig } from '@/shims/runtime-config';
import type { Entry } from 'contentful';
import { ArrowLeftIcon, CalendarDaysIcon, ClockIcon } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

export function BlogPostPage({
  config,
  post,
}: {
  config: RuntimeConfig;
  post: CMSPost;
}) {
  const category = getCategoryFields(post.category as Entry | null);
  const tags = (post.tags || [])
    .filter(isEntry)
    .map(getTagFields)
    .filter(Boolean);
  const heroUrl = getImageUrl(post.featuredImage, 1920);
  const heroDimensions = getImageDimensions(post.featuredImage);
  const heroAlt = getImageAlt(post.featuredImage) || post.title;

  return (
    <MarketingShell config={config}>
      <article className="py-8 sm:py-16 lg:py-24">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          {/* Back link */}
          <div className="mb-8">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/blog">
                <ArrowLeftIcon className="mr-2 size-4" />
                Back to Blog
              </Link>
            </Button>
          </div>

          {/* Header */}
          <header className="mb-8 space-y-4">
            {category && (
              <Link href={`/blog?category=${category.slug}`}>
                <Badge className="bg-primary/10 text-primary rounded-full border-0 text-sm">
                  {category.name}
                </Badge>
              </Link>
            )}

            <h1 className="text-3xl font-bold md:text-4xl lg:text-5xl">
              {post.title}
            </h1>

            {post.excerpt && (
              <p className="text-muted-foreground text-lg md:text-xl">
                {post.excerpt}
              </p>
            )}

            {/* Meta */}
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              {post.author && (
                <span className="font-medium text-foreground">
                  {post.author}
                </span>
              )}
              {post.publishedAt && (
                <div className="flex items-center gap-1.5">
                  <CalendarDaysIcon className="size-4" />
                  <span>{formatDate(post.publishedAt)}</span>
                </div>
              )}
              {post.readingTime && (
                <div className="flex items-center gap-1.5">
                  <ClockIcon className="size-4" />
                  <span>{post.readingTime} min read</span>
                </div>
              )}
            </div>
          </header>

          {/* Featured Image */}
          {heroUrl && (
            <div className="mb-10 overflow-hidden rounded-xl">
              <Image
                src={heroUrl}
                alt={heroAlt}
                width={heroDimensions?.width || 1920}
                height={heroDimensions?.height || 1080}
                className="w-full object-cover"
                priority
              />
            </div>
          )}

          {/* Content */}
          <div className="mb-12">
            <RichText content={post.content} />
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t pt-6">
              {tags.map((tag) => (
                <Badge
                  key={tag?.id}
                  variant="secondary"
                  className="rounded-full"
                >
                  {tag?.name}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </article>
    </MarketingShell>
  );
}
