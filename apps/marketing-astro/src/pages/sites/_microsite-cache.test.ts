/**
 * The cache policy is a CORRECTNESS decision, so it is pinned here rather than
 * left to a header literal in frontmatter that nobody diffs.
 *
 * Every assertion below fails against the policy this file replaced
 * (`public, s-maxage=300, stale-while-revalidate=86400` + a `Cache-Tag` header
 * Vercel does not read). That is the point: the bug it encoded — publish, and
 * the site keeps serving the old page, for up to 24h on a quiet tenant — was
 * invisible to every test we had.
 */
import { describe, expect, it } from 'vitest';
import {
  MICROSITE_EDGE_MAX_AGE_SECONDS,
  MICROSITE_NO_STORE_HEADERS,
  micrositeDocumentUrl,
  micrositePublishedCacheHeaders,
} from './_microsite-cache';

const published = () => micrositePublishedCacheHeaders('site-1');

describe('published cache policy', () => {
  /**
   * THE BUG, stated as a bound. A publish or a price edit cannot be invalidated
   * — Vercel cache keys are not configurable and nothing purges by tag — so the
   * ONLY thing standing between an owner and "I published and my site didn't
   * change" is how long this window is.
   */
  it('bounds staleness to a minute, not five', () => {
    expect(MICROSITE_EDGE_MAX_AGE_SECONDS).toBeLessThanOrEqual(60);

    const maxAge = /s-maxage=(\d+)/.exec(published()['Cache-Control'])?.[1];
    expect(Number(maxAge)).toBe(MICROSITE_EDGE_MAX_AGE_SECONDS);
  });

  /**
   * The half that actually destroyed trust: with a stale window the edge serves
   * the OLD page to the next visitor and revalidates behind them, so the person
   * who made the change never sees it — and on a low-traffic site every visitor
   * repeats that indefinitely.
   *
   * A short stale window would be defensible; a long one is not. This asserts
   * there is none at all, which is what the page ships.
   */
  it('has no stale-while-revalidate window', () => {
    expect(published()['Cache-Control']).not.toMatch(/stale-while-revalidate/);
    expect(published()['Cache-Control']).not.toMatch(/stale-if-error/);
  });

  /**
   * `s-maxage` caches at the SHARED edge only. If the browser cached it too, an
   * owner reloading after a publish would be served a private copy we cannot
   * reach at any TTL.
   */
  it('does not let the visitor browser hold a copy', () => {
    expect(published()['Cache-Control']).toMatch(/\bpublic\b/);
    expect(published()['Cache-Control']).toMatch(/\bmax-age=0\b/);
  });

  /**
   * The old code sent `Cache-Tag`, which Vercel ignores — so the comment
   * claiming publish purged that tag was untrue twice over. The tag is kept as
   * a MANUAL purge handle, under the name the platform actually reads.
   */
  it('emits the tag under the name Vercel reads', () => {
    expect(published()).toHaveProperty('Vercel-Cache-Tag', 'microsite-site-1');
    expect(published()).not.toHaveProperty('Cache-Tag');
  });
});

describe('non-published responses', () => {
  /**
   * A cached 404 outlives the DNS fix that resolves it, and a draft is content
   * the owner has not agreed to publish — neither may enter a shared cache.
   * `no-store`, not `private`: `private` still permits the browser to keep it.
   */
  it('never enter any cache', () => {
    expect(MICROSITE_NO_STORE_HEADERS['Cache-Control']).toBe('no-store');
    expect(MICROSITE_NO_STORE_HEADERS).not.toHaveProperty('Vercel-Cache-Tag');
  });
});

describe('micrositeDocumentUrl', () => {
  /**
   * ONE call. The renderer used to hit `/resolve` and then `/{id}/document` in
   * series, Vercel→Fly, for one answer.
   */
  it('carries the host and path so no separate resolve is needed', () => {
    const url = micrositeDocumentUrl('https://api.test/', {
      host: 'salon.com',
      path: '/sites/acme/about',
    });

    expect(url).toBe(
      'https://api.test/public/microsites/document?host=salon.com&path=%2Fsites%2Facme%2Fabout'
    );
    expect(url).not.toContain('/resolve');
  });

  /** Published-only by construction: there is no `mode` to leave unset. */
  it('cannot ask for a draft', () => {
    const url = micrositeDocumentUrl('https://api.test', {
      host: 'salon.com',
      path: '/',
    });

    expect(url).not.toContain('mode=');
    expect(url).not.toContain('token=');
  });
});
