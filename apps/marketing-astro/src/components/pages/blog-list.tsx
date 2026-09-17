'use client';

import { MarketingShell } from '@/components/marketing-shell';
import Blog, {
  type BlogPost,
} from '@/components/shadcn-studio/blocks/blog-component-15/blog-component-15';
import type { RuntimeConfig } from '@/shims/runtime-config';

export function BlogListPage({
  config,
  blogPosts,
  categories,
}: {
  config: RuntimeConfig;
  blogPosts: BlogPost[];
  categories: string[];
}) {
  return (
    <MarketingShell config={config}>
      <Blog blogPosts={blogPosts} categories={categories} />
    </MarketingShell>
  );
}
