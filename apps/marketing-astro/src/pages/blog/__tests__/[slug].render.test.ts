/**
 * ENG-850, AS AN ASSERTION.
 *
 * `Astro.rewrite('/404')` on a missing post threw `ForbiddenRewrite` — `/404`
 * is prerendered, so it has no entry in this SSR route's on-demand route map
 * — and every visitor to an unknown `/blog/{slug}` got a blank 500 instead of
 * a 404. Grepping the source only proves the `rewrite(` call is gone; this
 * renders the real page component through the real Astro container and
 * asserts on the `Response` a visitor would receive: the status code, the
 * cache header, and the branded not-found copy in the body. A known slug is
 * asserted too, so the fix is proven not to have broken the happy path.
 */
import { loadRenderers } from 'astro:container';
import type { CMSPost } from '@/features/blog/types';
import { getContainerRenderer as reactContainerRenderer } from '@astrojs/react';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchEntryBySlug } = vi.hoisted(() => ({
  fetchEntryBySlug: vi.fn(),
}));

vi.mock('@/lib/cms', () => ({ fetchEntryBySlug }));

/**
 * `astro@6.3.6`'s `experimental_AstroContainer.create()` never populates
 * `Astro.site` (there's no supported way to pass it in) so the real
 * `BaseLayout.astro` — which does `new URL(Astro.url.pathname, Astro.site)`
 * for the canonical link — throws `Invalid URL` under the container
 * regardless of what this test does. Swapped for a stub that keeps the same
 * props/slot contract; see the fixture file for the full explanation. This
 * is the only reason the mock exists — everything else here is the real
 * `[slug].astro`, `BlogPostPage` and `NotFoundPage`.
 */
vi.mock('@/layouts/BaseLayout.astro', async () => {
  const mod = await import('./__fixtures__/stub-base-layout.astro');
  return mod;
});

// Imported after the mocks so the page picks up the mocked modules. Lives in
// `__tests__/` (an Astro-ignored, underscore-prefixed directory, per
// https://docs.astro.build/en/basics/astro-pages/#excluding-pages) rather
// than alongside `[slug].astro`: any `.ts` file directly under `src/pages/`
// is a page/endpoint candidate to Astro's router, and `astro build` tried to
// load this test module as one — `vi.mock`/`expect` ran outside a Vitest
// worker and crashed the prerender step.
const Slug = (await import('../[slug].astro')).default;

const POST: CMSPost = {
  id: 'post_1',
  title: 'How Claire Books Appointments',
  slug: 'how-claire-books-appointments',
  excerpt: 'A look at the booking flow.',
  content: {
    nodeType: 'document',
    data: {},
    content: [],
  } as CMSPost['content'],
  featuredImage: null,
  category: null,
  tags: null,
  publishedAt: '2026-01-01T00:00:00.000Z',
  author: 'Borradh',
  seoTitle: null,
  seoDescription: null,
  canonicalUrl: null,
  readingTime: 4,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const renderSlug = async (slug: string) => {
  const renderers = await loadRenderers([reactContainerRenderer()]);
  const container = await AstroContainer.create({ renderers });
  return container.renderToResponse(Slug, {
    params: { slug },
    request: new Request(`https://www.borradh.io/blog/${slug}`),
  });
};

describe('GET /blog/[slug]', () => {
  beforeEach(() => {
    fetchEntryBySlug.mockReset();
  });

  it('returns a real 404, not a rewrite, for an unknown slug', async () => {
    fetchEntryBySlug.mockResolvedValue(null);

    const response = await renderSlug('this-does-not-exist');
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toContain('Page not found');
    // React SSR HTML-escapes the apostrophe as `&#x27;`.
    expect(body).toContain('find what you were looking for.');
  });

  it('renders the post and a 200 for a known slug', async () => {
    fetchEntryBySlug.mockResolvedValue(POST);

    const response = await renderSlug(POST.slug);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain(POST.title);
  });
});
