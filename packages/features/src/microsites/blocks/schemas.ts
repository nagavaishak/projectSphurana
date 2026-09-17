/**
 * Zod schemas for the microsite block library.
 *
 * The types live in `@borradh-workspace/web-shared` (THE CONTRACT). This file
 * is the *validation* half: `blocks` and `theme` are jsonb columns, so nothing
 * downstream will ever tell you a shape drifted — these schemas are the only
 * gate between the agent / the API and the renderer.
 *
 * DRIFT IS A COMPILE ERROR. Every schema below is paired with an
 * `AssertExact<z.infer<typeof schema>, ContractType>` assignment at the bottom
 * of its section. If the contract gains, loses or retypes a field and the Zod
 * schema does not follow (or vice versa), `pnpm turbo typecheck` fails with the
 * offending type named in the error. Do not delete those assertions.
 *
 * NOTE ON IMPORTS: every import from the contract is `import type`. The
 * web-shared package emits declarations only (no JS), so a *runtime* import
 * from it would resolve to a `.ts` file at runtime and blow up in Node. That is
 * also why `DATA_BOUND_BLOCKS` is consumed at the type level only — see
 * ./block-catalogue.ts, where the catalogue's `dataBound` flag is derived from
 * it by the type system rather than copied by hand.
 */

import { BLOCK_VARIANTS } from '@borradh-workspace/web-shared';
import type {
  Block,
  BlockBase,
  BlockType,
  CtaBookingProps,
  GalleryProps,
  HeroProps,
  MapLocationProps,
  MicrositeDocument,
  MicrositePage,
  MicrositeSeo,
  MicrositeTheme,
  OpeningHoursProps,
  RichTextProps,
  ServicesProps,
  TeamProps,
} from '@borradh-workspace/web-shared';
import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Drift guard                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Resolves to `true` when `Actual` and `Expected` are the same shape, and to an
 * *object* type describing the mismatch otherwise. Because the assertion sites
 * below do `const _x: AssertExact<A, B> = true`, a mismatch is a type error at
 * the assignment, and the error message carries the `error` field.
 *
 * Mutual assignability alone would miss an EXTRA OPTIONAL property (optional
 * props do not break assignability in either direction), so the key sets are
 * compared explicitly as well.
 */
type AssertExact<Actual, Expected> = [Actual] extends [Expected]
  ? [Expected] extends [Actual]
    ? [
        | Exclude<keyof Actual, keyof Expected>
        | Exclude<keyof Expected, keyof Actual>,
      ] extends [never]
      ? true
      : {
          error: 'Schema and contract type have different key sets';
          driftingKeys:
            | Exclude<keyof Actual, keyof Expected>
            | Exclude<keyof Expected, keyof Actual>;
        }
    : {
        error: 'Contract type is not assignable to the schema output';
        expected: Expected;
      }
  : {
      error: 'Schema output is not assignable to the contract type';
      actual: Actual;
    };

/* -------------------------------------------------------------------------- */
/* Block props                                                                 */
/* -------------------------------------------------------------------------- */

export const heroPropsSchema = z.object({
  headline: z.string().min(1, 'Headline is required'),
  subheadline: z.string().optional(),
  imageAssetId: z.string().min(1).optional(),
  ctaLabel: z.string().min(1).optional(),
  /** Internal path (`/book`) or absolute URL — never built from WEB_URL. */
  ctaHref: z.string().min(1).optional(),
});

export const servicesPropsSchema = z.object({
  title: z.string().optional(),
  intro: z.string().optional(),
  /** Empty/omitted = all active services. Data-bound: a QUERY, never a copy. */
  categoryNames: z.array(z.string().min(1)).optional(),
  limit: z.number().int().positive().max(100).optional(),
  showPrices: z.boolean().default(true),
});

export const teamPropsSchema = z.object({
  title: z.string().optional(),
  intro: z.string().optional(),
  practitionerIds: z.array(z.string().min(1)).optional(),
  showBios: z.boolean().default(true),
});

export const galleryPropsSchema = z.object({
  title: z.string().optional(),
  /** Explicit asset ids; empty = the org photo gallery. */
  assetIds: z.array(z.string().min(1)).optional(),
});

export const openingHoursPropsSchema = z.object({
  title: z.string().optional(),
  locationId: z.string().min(1).optional(),
  /**
   * Defaults to FALSE: exceptions are not in any public payload yet (plan §5),
   * so a `true` here would render nothing and look broken.
   */
  showExceptions: z.boolean().default(false),
});

export const mapLocationPropsSchema = z.object({
  title: z.string().optional(),
  locationId: z.string().min(1).optional(),
  showAddress: z.boolean().default(true),
  showMap: z.boolean().default(true),
});

export const ctaBookingPropsSchema = z.object({
  headline: z.string().min(1, 'Headline is required'),
  subtext: z.string().optional(),
  buttonLabel: z.string().min(1).default('Book now'),
});

export const richTextPropsSchema = z.object({
  /** Sanitized markdown subset. NEVER raw author HTML. */
  markdown: z.string().min(1, 'Markdown content is required'),
  align: z.enum(['left', 'center']).optional(),
});

const _heroProps: AssertExact<
  z.infer<typeof heroPropsSchema>,
  HeroProps
> = true;
const _servicesProps: AssertExact<
  z.infer<typeof servicesPropsSchema>,
  ServicesProps
> = true;
const _teamProps: AssertExact<
  z.infer<typeof teamPropsSchema>,
  TeamProps
> = true;
const _galleryProps: AssertExact<
  z.infer<typeof galleryPropsSchema>,
  GalleryProps
> = true;
const _openingHoursProps: AssertExact<
  z.infer<typeof openingHoursPropsSchema>,
  OpeningHoursProps
> = true;
const _mapLocationProps: AssertExact<
  z.infer<typeof mapLocationPropsSchema>,
  MapLocationProps
> = true;
const _ctaBookingProps: AssertExact<
  z.infer<typeof ctaBookingPropsSchema>,
  CtaBookingProps
> = true;
const _richTextProps: AssertExact<
  z.infer<typeof richTextPropsSchema>,
  RichTextProps
> = true;

/* -------------------------------------------------------------------------- */
/* Blocks                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * `variant` stays a plain `string` in the contract on purpose — the renderer
 * falls back to the first variant on an unknown value rather than 500ing on a
 * page the agent wrote last week. We therefore validate it as a string and only
 * *default* it to the catalogue's first variant. The catalogue
 * (./block-catalogue.ts) remains the single list of valid variants.
 */
const blockShape = <T extends BlockType>(type: T) =>
  ({
    id: z.string().min(1, 'Block id is required'),
    type: z.literal(type),
    variant: z.string().min(1).default(BLOCK_VARIANTS[type][0]),
  }) as const;

export const heroBlockSchema = z.object({
  ...blockShape('hero'),
  props: heroPropsSchema,
});

export const servicesBlockSchema = z.object({
  ...blockShape('services'),
  props: servicesPropsSchema,
});

export const teamBlockSchema = z.object({
  ...blockShape('team'),
  props: teamPropsSchema,
});

export const galleryBlockSchema = z.object({
  ...blockShape('gallery'),
  props: galleryPropsSchema,
});

export const openingHoursBlockSchema = z.object({
  ...blockShape('opening_hours'),
  props: openingHoursPropsSchema,
});

export const mapLocationBlockSchema = z.object({
  ...blockShape('map_location'),
  props: mapLocationPropsSchema,
});

export const ctaBookingBlockSchema = z.object({
  ...blockShape('cta_booking'),
  props: ctaBookingPropsSchema,
});

export const richTextBlockSchema = z.object({
  ...blockShape('rich_text'),
  props: richTextPropsSchema,
});

/**
 * The block union. `discriminatedUnion` (not `union`) so an unknown `type`
 * fails with `invalid_union_discriminator` naming the valid options, instead of
 * eight stacked irrelevant errors.
 */
export const blockSchema = z.discriminatedUnion('type', [
  heroBlockSchema,
  servicesBlockSchema,
  teamBlockSchema,
  galleryBlockSchema,
  openingHoursBlockSchema,
  mapLocationBlockSchema,
  ctaBookingBlockSchema,
  richTextBlockSchema,
]);

/**
 * Per-block schema lookup — the agent-tool layer generates one tool per block
 * type and needs the individual schema by key. `Record<BlockType, ...>` makes a
 * newly-added contract block type a compile error here.
 */
export const blockSchemaByType = {
  hero: heroBlockSchema,
  services: servicesBlockSchema,
  team: teamBlockSchema,
  gallery: galleryBlockSchema,
  opening_hours: openingHoursBlockSchema,
  map_location: mapLocationBlockSchema,
  cta_booking: ctaBookingBlockSchema,
  rich_text: richTextBlockSchema,
} satisfies Record<BlockType, z.ZodTypeAny>;

const _heroBlock: AssertExact<
  z.infer<typeof heroBlockSchema>,
  BlockBase<'hero', HeroProps>
> = true;
const _servicesBlock: AssertExact<
  z.infer<typeof servicesBlockSchema>,
  BlockBase<'services', ServicesProps>
> = true;
const _teamBlock: AssertExact<
  z.infer<typeof teamBlockSchema>,
  BlockBase<'team', TeamProps>
> = true;
const _galleryBlock: AssertExact<
  z.infer<typeof galleryBlockSchema>,
  BlockBase<'gallery', GalleryProps>
> = true;
const _openingHoursBlock: AssertExact<
  z.infer<typeof openingHoursBlockSchema>,
  BlockBase<'opening_hours', OpeningHoursProps>
> = true;
const _mapLocationBlock: AssertExact<
  z.infer<typeof mapLocationBlockSchema>,
  BlockBase<'map_location', MapLocationProps>
> = true;
const _ctaBookingBlock: AssertExact<
  z.infer<typeof ctaBookingBlockSchema>,
  BlockBase<'cta_booking', CtaBookingProps>
> = true;
const _richTextBlock: AssertExact<
  z.infer<typeof richTextBlockSchema>,
  BlockBase<'rich_text', RichTextProps>
> = true;

/**
 * The union-level guard. This is the one that catches a block type being ADDED
 * to the contract's `Block` union and forgotten here: `Block` would no longer
 * be assignable to the schema output.
 */
const _blockUnion: AssertExact<z.infer<typeof blockSchema>, Block> = true;

/* -------------------------------------------------------------------------- */
/* Theme, SEO, page, document                                                  */
/* -------------------------------------------------------------------------- */

/** Emitted as CSS custom properties. Kept as free strings so `oklch()`/`hsl()` work. */
const brandColour = z.string().min(1, 'Colour is required');

export const micrositeThemeSchema = z.object({
  brand: z.object({
    primary: brandColour,
    accent: brandColour,
    neutral: brandColour,
    surface: brandColour,
  }),
  /** ONE mark. Do NOT reintroduce light/dark/wordmark variants — see contract. */
  logo: z
    .object({ assetUrl: z.string().min(1).nullable() })
    .default({ assetUrl: null }),
  typography: z
    .object({
      scale: z.enum(['compact', 'default', 'editorial']).default('default'),
    })
    .default({ scale: 'default' }),
  radius: z.enum(['none', 'sm', 'md', 'full']).default('md'),
  buttonStyle: z.enum(['solid', 'outline', 'pill']).default('solid'),
  density: z.enum(['tight', 'comfortable']).default('comfortable'),
});

export const micrositeSeoSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  ogImageAssetId: z.string().min(1).optional(),
});

export const micrositePageSchema = z.object({
  id: z.string().min(1, 'Page id is required'),
  path: z
    .string()
    .min(1)
    .regex(/^\/[a-z0-9\-/]*$/, 'Path must start with "/" and be url-safe'),
  title: z.string().min(1, 'Page title is required'),
  seo: micrositeSeoSchema.default({}),
  blocks: z.array(blockSchema).default([]),
  order: z.number().int().min(0),
  /** System pages (booking) cannot be deleted by the agent or the user. */
  isSystem: z.boolean().default(false),
});

export const micrositeDocumentSchema = z.object({
  theme: micrositeThemeSchema,
  pages: z.array(micrositePageSchema).default([]),
});

const _theme: AssertExact<
  z.infer<typeof micrositeThemeSchema>,
  MicrositeTheme
> = true;
const _seo: AssertExact<
  z.infer<typeof micrositeSeoSchema>,
  MicrositeSeo
> = true;
const _page: AssertExact<
  z.infer<typeof micrositePageSchema>,
  MicrositePage
> = true;
const _document: AssertExact<
  z.infer<typeof micrositeDocumentSchema>,
  MicrositeDocument
> = true;

/* -------------------------------------------------------------------------- */
/* Inferred types (input = what a caller may send, output = what is stored)     */
/* -------------------------------------------------------------------------- */

export type BlockInput = z.input<typeof blockSchema>;
export type MicrositePageInput = z.input<typeof micrositePageSchema>;
export type MicrositeThemeInput = z.input<typeof micrositeThemeSchema>;
export type MicrositeDocumentInput = z.input<typeof micrositeDocumentSchema>;

/*
 * The `_*` consts above exist purely for their type annotations. Referencing
 * them here keeps `noUnusedLocals`-style lint rules quiet without weakening the
 * guard: deleting any schema/type pairing still fails the annotation itself.
 */
export const __contractDriftGuards = [
  _heroProps,
  _servicesProps,
  _teamProps,
  _galleryProps,
  _openingHoursProps,
  _mapLocationProps,
  _ctaBookingProps,
  _richTextProps,
  _heroBlock,
  _servicesBlock,
  _teamBlock,
  _galleryBlock,
  _openingHoursBlock,
  _mapLocationBlock,
  _ctaBookingBlock,
  _richTextBlock,
  _blockUnion,
  _theme,
  _seo,
  _page,
  _document,
] as const;
