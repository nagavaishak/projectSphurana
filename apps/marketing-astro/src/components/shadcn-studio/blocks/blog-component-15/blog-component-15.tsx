'use client';

import { ArrowRightIcon, CalendarDaysIcon, SearchIcon } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type BlogPost = {
  title: string;
  description: string;
  imageUrl: string;
  imageAlt: string;
  date: string;
  category: string;
  author: string;
  authorLink: string;
  blogLink: string;
  categoryLink: string;
};

type BlogProps = {
  blogPosts: BlogPost[];
  categories?: string[];
  title?: string;
  subtitle?: string;
  description?: string;
};

const BlogGrid = ({ posts }: { posts: BlogPost[] }) => {
  if (posts.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground text-lg">No posts found.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {posts.map((post, index) => (
        <Card
          key={index}
          className="group h-full overflow-hidden shadow-none transition-all duration-300"
        >
          <CardContent className="space-y-3.5">
            {post.imageUrl && (
              <div className="mb-6 overflow-hidden rounded-lg sm:mb-12">
                <Link href={post.blogLink}>
                  <Image
                    src={post.imageUrl}
                    alt={post.imageAlt}
                    width={768}
                    height={432}
                    className="h-59.5 w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                </Link>
              </div>
            )}
            <div className="flex items-center justify-between gap-1.5">
              <div className="text-muted-foreground flex items-center gap-1.5">
                <CalendarDaysIcon className="size-6" />
                <span>{post.date}</span>
              </div>
              {post.category && (
                <Link href={post.categoryLink}>
                  <Badge className="bg-primary/10 text-primary rounded-full border-0 text-sm">
                    {post.category}
                  </Badge>
                </Link>
              )}
            </div>
            <h3 className="line-clamp-2 text-lg font-medium md:text-xl">
              <Link href={post.blogLink}>{post.title}</Link>
            </h3>
            <p className="text-muted-foreground line-clamp-2">
              {post.description}
            </p>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{post.author}</span>
              <Button
                size="icon"
                variant="outline"
                className="group-hover:bg-primary! group-hover:text-primary-foreground group-hover:border-primary hover:border-primary hover:bg-primary! hover:text-primary-foreground"
                asChild
              >
                <Link href={post.blogLink}>
                  <ArrowRightIcon className="size-4 -rotate-45" />
                  <span className="sr-only">Read more: {post.title}</span>
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

const Blog = ({
  blogPosts,
  categories: categoriesProp,
  title = 'Latest from the Blog',
  subtitle = 'Blog',
  description = 'Insights, tips, and stories to help your clinic grow.',
}: BlogProps) => {
  const [search, setSearch] = useState('');

  // Derive categories from posts if not provided
  const categories = useMemo(() => {
    if (categoriesProp && categoriesProp.length > 0)
      return ['All', ...categoriesProp];
    const unique = [
      ...new Set(blogPosts.map((p) => p.category).filter(Boolean)),
    ];
    return ['All', ...unique];
  }, [categoriesProp, blogPosts]);

  // Filter posts by search term
  const filteredPosts = useMemo(() => {
    if (!search.trim()) return blogPosts;
    const term = search.toLowerCase();
    return blogPosts.filter(
      (post) =>
        post.title.toLowerCase().includes(term) ||
        post.description.toLowerCase().includes(term) ||
        post.author.toLowerCase().includes(term)
    );
  }, [search, blogPosts]);

  return (
    <section className="py-8 sm:py-16 lg:py-24">
      <div className="mx-auto max-w-7xl space-y-8 px-4 sm:px-6 lg:space-y-16 lg:px-8">
        {/* Header */}
        <div className="space-y-4">
          <p className="text-sm">{subtitle}</p>

          <h2 className="text-2xl font-semibold md:text-3xl lg:text-4xl">
            {title}
          </h2>

          <p className="text-muted-foreground text-lg md:text-xl">
            {description}
          </p>
        </div>

        {/* Tabs and Search */}
        <Tabs defaultValue="All" className="gap-8 lg:gap-16">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <ScrollArea className="bg-muted w-full rounded-lg sm:w-auto">
              <TabsList className="h-auto gap-1">
                {categories.map((category) => (
                  <TabsTrigger
                    key={category}
                    value={category}
                    className="hover:bg-primary/10 cursor-pointer rounded-lg px-4 text-base"
                  >
                    {category}
                  </TabsTrigger>
                ))}
              </TabsList>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>

            <div className="relative max-md:w-full">
              <div className="text-muted-foreground pointer-events-none absolute inset-y-0 left-0 flex items-center justify-center pl-3 peer-disabled:opacity-50">
                <SearchIcon className="size-4" />
                <span className="sr-only">Search</span>
              </div>
              <Input
                type="search"
                placeholder="Search posts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="peer h-10 px-9 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none"
              />
            </div>
          </div>

          {/* All Posts Tab */}
          <TabsContent value="All">
            <BlogGrid posts={filteredPosts} />
          </TabsContent>

          {/* Category-specific Tabs */}
          {categories.slice(1).map((category) => (
            <TabsContent key={category} value={category}>
              <BlogGrid
                posts={filteredPosts.filter(
                  (post) => post.category === category
                )}
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
};

export default Blog;
