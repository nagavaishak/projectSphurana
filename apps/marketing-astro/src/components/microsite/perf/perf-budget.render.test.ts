/**
 * §9 OF THE PLAN, AS AN ASSERTION.
 *
 *   "Budget: LCP < 2.0s on 4G — ad landing pages that load slowly cost money
 *    directly."
 *
 * A wall-clock number cannot be asserted here, and should not be: a timing
 * assertion in a unit suite is a coin flip against whatever else the machine
 * is doing, and a perf test that fails randomly is disabled within a week and
 * then protects nothing. The browser-level LCP gate lives in
 * `apps/marketing-astro-e2e/src/perf/microsite-lcp.spec.ts`.
 *
 * What IS assertable on every commit, with no browser, are the STRUCTURAL
 * CAUSES of a blown budget — the four things that actually move LCP and CLS on
 * a page like this:
 *
 *   1. Client JS. The renderer ships ZERO by design; the gallery carousel is
 *      CSS scroll-snap, not a hydrated island. One `client:load` on a block
 *      pulls in the React runtime and the budget is gone.
 *   2. Intrinsic image dimensions. An `<img>` with no width/height reserves no
 *      space, so every image below it reflows on decode. That is CLS, and on a
 *      hero it delays LCP paint.
 *   3. Loading priority. Lazy-loading the LCP image is the single easiest way
 *      to blow 2.0s; eager-loading everything else wastes the 4G budget on
 *      below-the-fold pixels.
 *   4. Webfonts. A render-blocking font round trip before first paint.
 *
 * These are properties of the OUTPUT, so they are asserted on the bytes a
 * visitor receives — not on the source, and not on a flag.
 */
import { readFileSync } from 'node:fs';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as reactContainerRenderer } from '@astrojs/react';
import type { Block, MicrositeTheme } from '@borradh-workspace/web-shared';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';
import BlockRenderer from '../BlockRenderer.astro';
import type { MicrositeData } from '../data';
import { themeCssText } from '../theme';

/**
 * THE ALLOWED-SCRIPT LIST.
 *
 * Empty, and that is the design: the published microsite ships no client JS.
 * Analytics (pixel + CAPI) is injected by the page shell, not by a block, and
 * is out of this renderer's scope.
 *
 * Adding a script to a block therefore has to be a deliberate edit to THIS
 * ARRAY, with a justification, rather than something that slips in under a
 * `client:visible` nobody reviewed. Each entry is a substring that a permitted
 * `<script ...>` tag must contain.
 */
const ALLOWED_SCRIPTS: readonly string[] = [];

/**
 * Hydration markers Astro emits for an island. `<script>` alone does not catch
 * these: `client:only` renders the placeholder element in this component's
 * output while the runtime script is emitted by the page bundle, so an island
 * added to a block can be invisible to a script-only check.
 */
const HYDRATION_MARKERS = [
  '<astro-island',
  'astro-island',
  'client:load',
  'client:visible',
  'client:idle',
  'client:only',
  'client:media',
];

const FONT_MARKERS = [
  '@font-face',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'use.typekit.net',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
];

const DATA: MicrositeData = {
  assets: {
    hero_img: {
      id: 'hero_img',
      url: 'https://cdn.test/hero.jpg',
      width: 1600,
      height: 900,
    },
    svc_img: {
      id: 'svc_img',
      url: 'https://cdn.test/svc.jpg',
      width: 640,
      height: 420,
    },
    // Deliberately DIMENSIONLESS. Assets round-trip through jsonb and a real
    // upload can arrive without dimensions; the block must still emit explicit
    // width/height from its fallback rather than shipping an unsized image.
    member_img: { id: 'member_img', url: 'https://cdn.test/aoife.jpg' },
    shot_1: {
      id: 'shot_1',
      url: 'https://cdn.test/1.jpg',
      width: 800,
      height: 800,
    },
    shot_2: { id: 'shot_2', url: 'https://cdn.test/2.jpg' },
  },
  services: [
    {
      id: 'svc_1',
      name: 'Deluxe Facial',
      priceLabel: '€90',
      durationLabel: '60 min',
      description: 'A facial.',
      imageAssetId: 'svc_img',
    },
  ],
  practitioners: [
    {
      id: 'prac_1',
      name: 'Aoife Byrne',
      role: 'Therapist',
      bio: 'Ten years.',
      imageAssetId: 'member_img',
    },
  ],
  locations: [
    {
      id: 'loc_1',
      name: 'Dublin',
      addressLines: ['12 Baggot Street', 'Dublin 2'],
      phone: '+353 1 555 0000',
      email: 'hello@glow.test',
      mapEmbedUrl: 'https://maps.test/embed?q=dublin',
      directionsUrl: 'https://maps.test/dir',
      openingHours: [{ label: 'Monday', intervals: ['09:00 – 17:00'] }],
    },
  ],
  gallery: [
    { id: 'shot_1', url: 'https://cdn.test/1.jpg', width: 800, height: 800 },
    { id: 'shot_2', url: 'https://cdn.test/2.jpg' },
  ],
  bookingUrl: 'https://app.test/book/glow',
  businessName: 'Glow Clinic',
};

/**
 * A realistic ad landing page: hero first (the LCP element), then the blocks a
 * tenant page actually carries — every image-bearing block is represented, so
 * a regression in any of them is caught.
 */
const BLOCKS: Block[] = [
  {
    id: 'blk_hero',
    type: 'hero',
    variant: 'image-right',
    props: {
      headline: 'Glow Clinic',
      subheadline: 'Skin care in Dublin 2',
      imageAssetId: 'hero_img',
      ctaLabel: 'Book now',
      ctaHref: '/book',
    },
  },
  {
    id: 'blk_services',
    type: 'services',
    variant: 'cards',
    props: { title: 'Our services', intro: 'What we do', showPrices: true },
  },
  {
    id: 'blk_team',
    type: 'team',
    variant: 'grid',
    props: { title: 'Our team', intro: 'Who we are', showBios: true },
  },
  {
    id: 'blk_gallery',
    type: 'gallery',
    variant: 'carousel',
    props: { title: 'Gallery' },
  },
  {
    id: 'blk_hours',
    type: 'opening_hours',
    variant: 'table',
    props: { title: 'Opening hours', showExceptions: false },
  },
  {
    id: 'blk_map',
    type: 'map_location',
    variant: 'split',
    props: { title: 'Find us', showAddress: true, showMap: true },
  },
  {
    id: 'blk_cta',
    type: 'cta_booking',
    variant: 'band',
    props: {
      headline: 'Ready?',
      subtext: 'Book online',
      buttonLabel: 'Book now',
    },
  },
  {
    id: 'blk_rich',
    type: 'rich_text',
    variant: 'prose',
    props: { markdown: '## About us\n\nWe are **open**.' },
  },
];

/** Every `<img ...>` tag in the document, in source order. */
const imgTags = (html: string): string[] => html.match(/<img\b[^>]*>/gi) ?? [];

const attr = (tag: string, name: string): string | undefined => {
  const m = tag.match(
    new RegExp(`\\b${name}=("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  );
  return m ? (m[2] ?? m[3] ?? m[4]) : undefined;
};

describe('the published microsite render stays inside the §9 LCP budget', () => {
  let html = '';
  let imgs: string[] = [];

  beforeAll(async () => {
    // The React renderer is registered DELIBERATELY. Without it a block that
    // grew an island would throw here ("No valid renderer was found") — a red
    // test, but a confusing one. With it the island renders exactly as it
    // would in production and the hydration-marker assertion below is what
    // names the problem.
    const renderers = await loadRenderers([reactContainerRenderer()]);
    const container = await AstroContainer.create({ renderers });
    const parts: string[] = [];
    for (const [index, block] of BLOCKS.entries()) {
      parts.push(
        await container.renderToString(BlockRenderer, {
          props: { block, data: DATA, index },
        })
      );
    }
    html = parts.join('\n');
    imgs = imgTags(html);
  });

  it('rendered the whole page — otherwise every absence below is vacuous', () => {
    expect(html).toContain('Glow Clinic');
    expect(html).toContain('Deluxe Facial');
    expect(html).toContain('Aoife Byrne');
    expect(html).toContain('Opening hours');
    expect(html).toContain('Find us');
    expect(html).toContain('About us');
    // 1 hero + 1 service card + 1 member + 2 gallery shots.
    expect(imgs).toHaveLength(5);
  });

  // ---- 1. Client JS ------------------------------------------------------

  it('ships no <script> beyond the allowed list', () => {
    const scripts: string[] = html.match(/<script\b[^>]*>/gi) ?? [];
    const unexpected = scripts.filter(
      (tag) => !ALLOWED_SCRIPTS.some((allowed) => tag.includes(allowed))
    );
    expect(
      unexpected,
      'Unexpected <script> in a published microsite render. The renderer ships zero client JS by design. If this script is genuinely required, add its signature to ALLOWED_SCRIPTS in this file with a justification.'
    ).toEqual([]);
  });

  it('hydrates no island — a block must never become an interactive component', () => {
    for (const marker of HYDRATION_MARKERS) {
      expect(
        html.includes(marker),
        `Found hydration marker "${marker}". A block was turned into a client component; that pulls the React runtime onto an ad landing page.`
      ).toBe(false);
    }
  });

  it('keeps the gallery carousel as CSS scroll-snap, not JS', () => {
    // The carousel variant renders, and carries no inline behaviour. Its
    // scroll-snap rules live in the component's scoped <style>, which Astro
    // hoists into the page bundle rather than into this fragment — so the
    // stylesheet half is asserted against the source below.
    expect(html).toContain('ms-gallery--carousel');
    expect(html).not.toMatch(/\bon(click|scroll|load|mouseover)=/i);

    const source = readFileSync(
      new URL('../blocks/Gallery.astro', import.meta.url),
      'utf8'
    );
    expect(source).toContain('scroll-snap-type');
    expect(source).not.toMatch(/<script/i);
  });

  // ---- 2 & 3. Image dimensions and loading priority ----------------------

  it('gives every <img> an explicit, numeric width and height', () => {
    for (const tag of imgs) {
      const w = attr(tag, 'width');
      const h = attr(tag, 'height');
      expect(w, `Missing width on ${tag}`).toBeDefined();
      expect(h, `Missing height on ${tag}`).toBeDefined();
      expect(Number(w), `Non-numeric width on ${tag}`).toBeGreaterThan(0);
      expect(Number(h), `Non-numeric height on ${tag}`).toBeGreaterThan(0);
    }
  });

  it('loads the first-block hero image eagerly, at high priority', () => {
    const hero = imgs[0];
    expect(hero).toContain('https://cdn.test/hero.jpg');
    expect(attr(hero, 'loading')).toBe('eager');
    expect(attr(hero, 'fetchpriority')).toBe('high');
  });

  it('lazy-loads every OTHER image, and gives none of them high priority', () => {
    for (const tag of imgs.slice(1)) {
      expect(attr(tag, 'loading'), `Not lazy: ${tag}`).toBe('lazy');
      expect(
        attr(tag, 'fetchpriority'),
        `Competes with the LCP image: ${tag}`
      ).not.toBe('high');
    }
  });

  it('lazy-loads the third-party map iframe', () => {
    const iframes: string[] = html.match(/<iframe\b[^>]*>/gi) ?? [];
    expect(iframes).toHaveLength(1);
    expect(attr(iframes[0], 'loading')).toBe('lazy');
  });

  // ---- 4. Webfonts -------------------------------------------------------

  it('loads no webfont from the blocks', () => {
    for (const marker of FONT_MARKERS) {
      expect(
        html.toLowerCase().includes(marker),
        `Found webfont marker "${marker}" — a render-blocking round trip before first paint.`
      ).toBe(false);
    }
    expect(html).not.toMatch(/<link[^>]+as=["']?font/i);
  });

  it('loads no webfont from the theme — every scale is a system stack', () => {
    const scales = ['compact', 'default', 'editorial'] as const;
    for (const scale of scales) {
      const css = themeCssText({
        brand: {
          primary: '#0a7',
          accent: '#0a7',
          neutral: '#555',
          surface: '#fff',
        },
        radius: 'md',
        density: 'comfortable',
        typography: { scale },
        buttonStyle: 'solid',
      } as MicrositeTheme).toLowerCase();
      for (const marker of FONT_MARKERS) {
        expect(
          css.includes(marker),
          `Theme scale "${scale}" loads ${marker}`
        ).toBe(false);
      }
      expect(css).toContain('--ms-heading-family');
    }
  });
});

/**
 * THE CONTROL.
 *
 * Absence proves nothing unless the harness can be shown to detect the thing it
 * is looking for. These feed the same extractors the assertions above use a
 * document that HAS the defects, and assert that they are seen.
 */
describe('the harness detects the defects it claims to guard against', () => {
  const BAD =
    '<img src="/a.jpg">' +
    '<img src="/b.jpg" width="10" height="10" loading="eager" fetchpriority="high">' +
    '<script type="module" src="/island.js"></script>' +
    '<astro-island uid="x"></astro-island>' +
    '<style>@font-face{font-family:X;src:url(/x.woff2)}</style>';

  it('sees an <img> with no dimensions', () => {
    const tag = imgTags(BAD)[0];
    expect(attr(tag, 'width')).toBeUndefined();
    expect(attr(tag, 'height')).toBeUndefined();
  });

  it('sees an eager, high-priority image where a lazy one belongs', () => {
    const tag = imgTags(BAD)[1];
    expect(attr(tag, 'loading')).toBe('eager');
    expect(attr(tag, 'fetchpriority')).toBe('high');
  });

  it('sees a <script> that is not on the allowed list', () => {
    const scripts: string[] = BAD.match(/<script\b[^>]*>/gi) ?? [];
    expect(
      scripts.filter((t) => !ALLOWED_SCRIPTS.some((a) => t.includes(a)))
    ).toHaveLength(1);
  });

  it('sees a hydrated island', () => {
    expect(HYDRATION_MARKERS.some((m) => BAD.includes(m))).toBe(true);
  });

  it('sees a webfont', () => {
    expect(FONT_MARKERS.some((m) => BAD.toLowerCase().includes(m))).toBe(true);
  });
});
