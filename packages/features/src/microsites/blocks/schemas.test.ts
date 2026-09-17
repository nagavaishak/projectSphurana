import { describe, expect, it } from '@borradh-workspace/testing';
import {
  BLOCK_TYPES,
  isDataBoundBlock,
  resolveVariant,
  variantsForBlock,
} from './block-catalogue.js';
import {
  blockSchema,
  blockSchemaByType,
  ctaBookingBlockSchema,
  galleryBlockSchema,
  heroBlockSchema,
  mapLocationBlockSchema,
  micrositeDocumentSchema,
  micrositePageSchema,
  micrositeThemeSchema,
  openingHoursBlockSchema,
  richTextBlockSchema,
  servicesBlockSchema,
  teamBlockSchema,
} from './schemas.js';

/**
 * One minimal-but-valid example per block type. These are deliberately the
 * SMALLEST payload that should parse: every optional field is omitted, so the
 * defaults assertions below are meaningful.
 */
const VALID_BLOCKS: Record<string, unknown> = {
  hero: {
    id: 'blk_hero_1',
    type: 'hero',
    variant: 'full-bleed',
    props: { headline: 'Beautiful skin, expertly cared for' },
  },
  services: {
    id: 'blk_services_1',
    type: 'services',
    variant: 'grid',
    props: {},
  },
  team: { id: 'blk_team_1', type: 'team', variant: 'grid', props: {} },
  gallery: {
    id: 'blk_gallery_1',
    type: 'gallery',
    variant: 'grid',
    props: {},
  },
  opening_hours: {
    id: 'blk_hours_1',
    type: 'opening_hours',
    variant: 'table',
    props: {},
  },
  map_location: {
    id: 'blk_map_1',
    type: 'map_location',
    variant: 'split',
    props: {},
  },
  cta_booking: {
    id: 'blk_cta_1',
    type: 'cta_booking',
    variant: 'banner',
    props: { headline: 'Ready to book?' },
  },
  rich_text: {
    id: 'blk_text_1',
    type: 'rich_text',
    variant: 'default',
    props: { markdown: '## About us\n\nWe have been open since 2011.' },
  },
};

describe('block catalogue', () => {
  it('covers every block type in the contract union', () => {
    // If a block type is added to the contract and not to the catalogue this
    // file would not compile; this asserts the runtime keys agree with the
    // schema map, which is the other half of the same invariant.
    expect(BLOCK_TYPES.sort()).toEqual(Object.keys(blockSchemaByType).sort());
  });

  it('marks exactly the four data-bound blocks as data-bound', () => {
    const dataBound = BLOCK_TYPES.filter(isDataBoundBlock).sort();
    expect(dataBound).toEqual([
      'map_location',
      'opening_hours',
      'services',
      'team',
    ]);
  });

  it('never marks an authored-copy block as data-bound', () => {
    expect(isDataBoundBlock('hero')).toBe(false);
    expect(isDataBoundBlock('rich_text')).toBe(false);
    expect(isDataBoundBlock('cta_booking')).toBe(false);
    expect(isDataBoundBlock('gallery')).toBe(false);
  });

  it('gives every block at least one variant', () => {
    for (const type of BLOCK_TYPES) {
      expect(variantsForBlock(type).length).toBeGreaterThan(0);
    }
  });

  it('resolveVariant keeps a known variant and falls back on an unknown one', () => {
    expect(resolveVariant('hero', 'full-bleed')).toBe('full-bleed');
    // `video-bg` is in the plan but NOT implemented by the renderer, so it is
    // deliberately absent from BLOCK_VARIANTS. If it were listed, the agent
    // could pick it and the renderer would silently fall back — a wrong layout
    // on a live site with nothing failing. Re-add here when the component ships.
    expect(resolveVariant('hero', 'video-bg')).toBe('image-right');
    expect(resolveVariant('hero', 'not-a-real-variant')).toBe('image-right');
    expect(resolveVariant('services', '')).toBe('cards');
  });
});

describe('per-block schemas', () => {
  const cases = [
    ['hero', heroBlockSchema],
    ['services', servicesBlockSchema],
    ['team', teamBlockSchema],
    ['gallery', galleryBlockSchema],
    ['opening_hours', openingHoursBlockSchema],
    ['map_location', mapLocationBlockSchema],
    ['cta_booking', ctaBookingBlockSchema],
    ['rich_text', richTextBlockSchema],
  ] as const;

  for (const [type, schema] of cases) {
    it(`parses a valid ${type} block`, () => {
      const result = schema.safeParse(VALID_BLOCKS[type]);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(type);
        expect(result.data.id).toBe((VALID_BLOCKS[type] as { id: string }).id);
      }
    });

    it(`rejects a ${type} block whose variant is not a string`, () => {
      const result = schema.safeParse({
        ...(VALID_BLOCKS[type] as object),
        variant: 42,
      });
      expect(result.success).toBe(false);
    });

    it(`rejects a ${type} block with a missing id`, () => {
      const { id: _id, ...withoutId } = VALID_BLOCKS[type] as { id: string };
      expect(schema.safeParse(withoutId).success).toBe(false);
    });
  }

  it('rejects a hero block with no headline', () => {
    const result = heroBlockSchema.safeParse({
      id: 'blk_hero_2',
      type: 'hero',
      variant: 'full-bleed',
      props: { subheadline: 'only a subheadline' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('headline'))).toBe(
        true
      );
    }
  });

  it('rejects a services block whose showPrices is a string', () => {
    const result = servicesBlockSchema.safeParse({
      id: 'blk_services_2',
      type: 'services',
      variant: 'grid',
      props: { showPrices: 'yes' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.join('.') === 'props.showPrices')
      ).toBe(true);
    }
  });

  it('rejects a services block whose categoryNames is not an array of strings', () => {
    expect(
      servicesBlockSchema.safeParse({
        id: 'blk_services_3',
        type: 'services',
        variant: 'grid',
        props: { categoryNames: [1, 2, 3] },
      }).success
    ).toBe(false);
  });

  it('ignores a stray layout prop — variant is the only layout authority', () => {
    // `layout` was removed from GalleryProps because it duplicated `variant`.
    // An agent that still emits it must not fail parsing, but it must also not
    // influence the layout: Zod strips the unknown key and `variant` decides.
    const parsed = galleryBlockSchema.parse({
      ...VALID_BLOCKS.gallery,
      variant: 'carousel',
      props: { ...VALID_BLOCKS.gallery.props, layout: 'masonry' },
    });
    expect(parsed.variant).toBe('carousel');
    expect((parsed.props as Record<string, unknown>).layout).toBeUndefined();
  });

  it('rejects a rich_text block with empty markdown', () => {
    expect(
      richTextBlockSchema.safeParse({
        id: 'blk_text_2',
        type: 'rich_text',
        variant: 'default',
        props: { markdown: '' },
      }).success
    ).toBe(false);
  });

  it('rejects a rich_text block with an unknown align', () => {
    expect(
      richTextBlockSchema.safeParse({
        id: 'blk_text_3',
        type: 'rich_text',
        variant: 'default',
        props: { markdown: 'hi', align: 'justify' },
      }).success
    ).toBe(false);
  });
});

describe('block defaults', () => {
  it('defaults services.showPrices to true', () => {
    const parsed = servicesBlockSchema.parse(VALID_BLOCKS.services);
    expect(parsed.props.showPrices).toBe(true);
  });

  it('defaults team.showBios to true', () => {
    expect(teamBlockSchema.parse(VALID_BLOCKS.team).props.showBios).toBe(true);
  });

  it('defaults gallery layout via variant, not a duplicate prop', () => {
    // `layout` used to live on props AND variant. Two sources for one concept
    // is how a block ends up rendering one layout while the agent believes it
    // set another, so the prop is gone and `variant` is the only authority.
    expect(galleryBlockSchema.parse(VALID_BLOCKS.gallery).variant).toBe('grid');
    expect(resolveVariant('gallery', 'nonsense')).toBe('grid');
  });

  it('defaults opening_hours.showExceptions to FALSE (no public payload yet)', () => {
    expect(
      openingHoursBlockSchema.parse(VALID_BLOCKS.opening_hours).props
        .showExceptions
    ).toBe(false);
  });

  it('defaults map_location.showAddress and showMap to true', () => {
    const parsed = mapLocationBlockSchema.parse(VALID_BLOCKS.map_location);
    expect(parsed.props.showAddress).toBe(true);
    expect(parsed.props.showMap).toBe(true);
  });

  it('defaults cta_booking.buttonLabel to a usable label', () => {
    const parsed = ctaBookingBlockSchema.parse(VALID_BLOCKS.cta_booking);
    expect(parsed.props.buttonLabel).toBe('Book now');
  });

  it('leaves rich_text.align undefined when omitted (it is optional in the contract)', () => {
    const parsed = richTextBlockSchema.parse(VALID_BLOCKS.rich_text);
    expect(parsed.props.align).toBeUndefined();
  });

  it("defaults a block's variant to the catalogue's first variant", () => {
    const parsed = heroBlockSchema.parse({
      id: 'blk_hero_3',
      type: 'hero',
      props: { headline: 'No variant given' },
    });
    expect(parsed.variant).toBe(variantsForBlock('hero')[0]);
    expect(parsed.variant).toBe('image-right');
  });

  it('does not overwrite an explicitly supplied variant', () => {
    const parsed = heroBlockSchema.parse({
      id: 'blk_hero_4',
      type: 'hero',
      variant: 'full-bleed',
      props: { headline: 'Explicit' },
    });
    expect(parsed.variant).toBe('full-bleed');
  });
});

describe('blockSchema discriminated union', () => {
  it('parses every valid block example', () => {
    for (const type of BLOCK_TYPES) {
      const result = blockSchema.safeParse(VALID_BLOCKS[type]);
      expect(result.success, `${type} should parse`).toBe(true);
    }
  });

  it('rejects an unknown block type', () => {
    const result = blockSchema.safeParse({
      id: 'blk_x',
      type: 'testimonials',
      variant: 'grid',
      props: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['type']);
    }
  });

  it('rejects a missing block type', () => {
    expect(
      blockSchema.safeParse({ id: 'blk_x', variant: 'grid', props: {} }).success
    ).toBe(false);
  });

  it('applies the discriminated branch, not a permissive one', () => {
    // `props.headline` is required for hero. If the union fell back to another
    // branch (or to a passthrough) this would wrongly succeed.
    expect(
      blockSchema.safeParse({
        id: 'blk_hero_5',
        type: 'hero',
        variant: 'full-bleed',
        props: {},
      }).success
    ).toBe(false);
  });

  it('does not let a cta_booking payload pass as a hero', () => {
    expect(
      blockSchema.safeParse({
        id: 'blk_mixed',
        type: 'cta_booking',
        variant: 'banner',
        props: { subtext: 'no headline here' },
      }).success
    ).toBe(false);
  });
});

describe('micrositeThemeSchema', () => {
  const minimalTheme = {
    brand: {
      primary: '#0f172a',
      accent: '#e11d48',
      neutral: '#64748b',
      surface: '#ffffff',
    },
  };

  it('applies every theme default from a bare brand palette', () => {
    const parsed = micrositeThemeSchema.parse(minimalTheme);
    expect(parsed.logo).toEqual({ assetUrl: null });
    expect(parsed.typography.scale).toBe('default');
    expect(parsed.radius).toBe('md');
    expect(parsed.buttonStyle).toBe('solid');
    expect(parsed.density).toBe('comfortable');
  });

  it('accepts a null logo assetUrl', () => {
    const parsed = micrositeThemeSchema.parse({
      ...minimalTheme,
      logo: { assetUrl: null },
    });
    expect(parsed.logo.assetUrl).toBeNull();
  });

  it('rejects a missing brand colour', () => {
    expect(
      micrositeThemeSchema.safeParse({
        brand: { primary: '#000', accent: '#111', neutral: '#222' },
      }).success
    ).toBe(false);
  });

  it('rejects an empty brand colour', () => {
    expect(
      micrositeThemeSchema.safeParse({
        brand: { ...minimalTheme.brand, primary: '' },
      }).success
    ).toBe(false);
  });

  it('rejects an unknown radius', () => {
    expect(
      micrositeThemeSchema.safeParse({ ...minimalTheme, radius: 'rounded' })
        .success
    ).toBe(false);
  });

  it('rejects an unknown typography scale', () => {
    expect(
      micrositeThemeSchema.safeParse({
        ...minimalTheme,
        typography: { scale: 'huge' },
      }).success
    ).toBe(false);
  });
});

describe('micrositePageSchema', () => {
  const basePage = {
    id: 'page_home',
    path: '/',
    title: 'Home',
    order: 0,
  };

  it('defaults seo, blocks and isSystem', () => {
    const parsed = micrositePageSchema.parse(basePage);
    expect(parsed.seo).toEqual({});
    expect(parsed.blocks).toEqual([]);
    expect(parsed.isSystem).toBe(false);
  });

  it('rejects a path that does not start with a slash', () => {
    expect(
      micrositePageSchema.safeParse({ ...basePage, path: 'about' }).success
    ).toBe(false);
  });

  it('rejects a negative order', () => {
    expect(
      micrositePageSchema.safeParse({ ...basePage, order: -1 }).success
    ).toBe(false);
  });

  it('rejects a non-integer order', () => {
    expect(
      micrositePageSchema.safeParse({ ...basePage, order: 1.5 }).success
    ).toBe(false);
  });

  it('rejects a page containing an invalid block', () => {
    const result = micrositePageSchema.safeParse({
      ...basePage,
      blocks: [
        { id: 'blk_bad', type: 'hero', variant: 'full-bleed', props: {} },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path.slice(0, 2)).toEqual(['blocks', 0]);
    }
  });
});

describe('realistic multi-block page round-trip', () => {
  const page = {
    id: 'page_home',
    path: '/',
    title: 'Radiance Skin Clinic',
    seo: {
      title: 'Radiance Skin Clinic — Dublin',
      description: 'Medical-grade skincare in Dublin 2.',
    },
    order: 0,
    isSystem: true,
    blocks: [
      {
        id: 'blk_1',
        type: 'hero',
        variant: 'full-bleed',
        props: {
          headline: 'Skin that speaks for itself',
          subheadline: 'Medical-grade treatments, delivered by clinicians.',
          imageAssetId: 'asset_hero_01',
          ctaLabel: 'Book a consultation',
          ctaHref: '/book',
        },
      },
      { id: 'blk_2', type: 'services', variant: 'grid', props: { limit: 6 } },
      {
        id: 'blk_3',
        type: 'team',
        variant: 'carousel',
        props: { title: 'Meet the team', showBios: false },
      },
      {
        id: 'blk_4',
        type: 'rich_text',
        variant: 'narrow',
        props: { markdown: 'Open since 2011.', align: 'center' },
      },
      {
        id: 'blk_5',
        type: 'opening_hours',
        variant: 'table',
        props: { locationId: 'loc_1' },
      },
      {
        id: 'blk_6',
        type: 'map_location',
        variant: 'split',
        props: { locationId: 'loc_1', showMap: false },
      },
      {
        id: 'blk_7',
        type: 'cta_booking',
        variant: 'centered',
        props: { headline: 'Ready when you are', buttonLabel: 'Book online' },
      },
    ],
  };

  it('parses the whole page and preserves block order and ids', () => {
    const parsed = micrositePageSchema.parse(page);
    expect(parsed.blocks.map((b) => b.id)).toEqual([
      'blk_1',
      'blk_2',
      'blk_3',
      'blk_4',
      'blk_5',
      'blk_6',
      'blk_7',
    ]);
    expect(parsed.isSystem).toBe(true);
    expect(parsed.seo.description).toBe('Medical-grade skincare in Dublin 2.');
  });

  it('is idempotent: re-parsing the parsed output is a fixed point', () => {
    const once = micrositePageSchema.parse(page);
    const twice = micrositePageSchema.parse(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });

  it('applies defaults to the blocks that omitted them without clobbering explicit values', () => {
    const parsed = micrositePageSchema.parse(page);
    const services = parsed.blocks.find((b) => b.type === 'services');
    const team = parsed.blocks.find((b) => b.type === 'team');
    const map = parsed.blocks.find((b) => b.type === 'map_location');

    expect(services?.props.showPrices).toBe(true); // defaulted
    expect(team?.props.showBios).toBe(false); // explicit — not overwritten
    expect(map?.props.showAddress).toBe(true); // defaulted
    expect(map?.props.showMap).toBe(false); // explicit — not overwritten
  });

  it('parses a whole document of theme + pages', () => {
    const parsed = micrositeDocumentSchema.parse({
      theme: {
        brand: {
          primary: '#0f172a',
          accent: '#e11d48',
          neutral: '#64748b',
          surface: '#ffffff',
        },
        radius: 'full',
        buttonStyle: 'pill',
      },
      pages: [
        page,
        { id: 'page_book', path: '/book', title: 'Book', order: 1 },
      ],
    });

    expect(parsed.pages).toHaveLength(2);
    expect(parsed.theme.radius).toBe('full');
    expect(parsed.theme.density).toBe('comfortable'); // defaulted
    expect(parsed.pages[1]?.blocks).toEqual([]);
  });

  it('rejects a document whose theme is missing', () => {
    expect(micrositeDocumentSchema.safeParse({ pages: [] }).success).toBe(
      false
    );
  });

  it('rejects a document with a bad block buried inside a page', () => {
    const result = micrositeDocumentSchema.safeParse({
      theme: {
        brand: {
          primary: '#0f172a',
          accent: '#e11d48',
          neutral: '#64748b',
          surface: '#ffffff',
        },
      },
      pages: [
        {
          ...page,
          blocks: [
            ...page.blocks,
            { id: 'blk_8', type: 'faq', variant: 'default', props: {} },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
