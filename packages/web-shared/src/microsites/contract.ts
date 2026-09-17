/**
 * THE PHASE 1 CONTRACT.
 *
 * This file is the single coordination point for the microsite work: the block
 * union, the theme, and the page/document shapes. The database jsonb columns,
 * the Astro renderer, the provisioning service and (later) the agent tools all
 * key off these types. Change them deliberately — a silent shape change here
 * breaks three packages at once, and `blocks: jsonb` means TypeScript will not
 * tell you.
 *
 * Zod schemas live in ./schemas.ts and MUST stay in exact correspondence with
 * these types (`satisfies` where possible). Types alone are not validation —
 * jsonb round-trips whatever it is given.
 */

/** Phase 1 block set. Later phases add: testimonials, faq, logos, stats, contact_form, offers, custom_html. */
export type BlockType =
  | 'hero'
  | 'services'
  | 'team'
  | 'gallery'
  | 'opening_hours'
  | 'map_location'
  | 'cta_booking'
  | 'rich_text';

/**
 * Data-bound blocks hold a QUERY, never a copy of the data. This is the whole
 * differentiator: services, team, hours and prices stay live, so a price edit
 * in the dashboard shows on the website without a republish and without the
 * agent being involved. Never denormalise business data into `props`.
 */
export const DATA_BOUND_BLOCKS = [
  'services',
  'team',
  'opening_hours',
  'map_location',
] as const satisfies readonly BlockType[];

/**
 * THE canonical variant list. First entry is the fallback: an unknown variant
 * renders as `[0]` rather than throwing, so one bad block never takes down a
 * tenant's whole page.
 *
 * This lives in the contract, not in the renderer and not in the feature
 * catalogue, because it was independently invented in BOTH and the two lists
 * disagreed — `services` was `cards|list|price-menu` in one and something else
 * in the other. A variant the renderer cannot draw is a blank section on a
 * live customer site, so there is exactly one list and both sides derive from
 * it.
 */
export const BLOCK_VARIANTS = {
  hero: ['image-right', 'full-bleed', 'text-only'],
  services: ['cards', 'list', 'price-menu'],
  team: ['grid', 'row'],
  gallery: ['grid', 'carousel'],
  opening_hours: ['table', 'inline'],
  map_location: ['split', 'map-full', 'address-only'],
  cta_booking: ['band', 'panel'],
  rich_text: ['prose', 'narrow'],
} as const satisfies Record<BlockType, readonly [string, ...string[]]>;

export type VariantFor<T extends BlockType> =
  (typeof BLOCK_VARIANTS)[T][number];

/** Unknown variant -> the block's fallback. Never throws. */
export function resolveVariant<T extends BlockType>(
  type: T,
  variant: string
): VariantFor<T> {
  const allowed = BLOCK_VARIANTS[type] as readonly string[];
  return (allowed.includes(variant) ? variant : allowed[0]) as VariantFor<T>;
}

export interface BlockBase<T extends BlockType, P> {
  /** Stable across edits — the agent addresses blocks by this id. */
  id: string;
  type: T;
  /** Layout variant. Renderer must fall back to the first variant on unknown values. */
  variant: string;
  props: P;
}

export interface HeroProps {
  headline: string;
  subheadline?: string;
  /** Asset id or resolved URL. Renderer resolves ids via the assets pipeline. */
  imageAssetId?: string;
  ctaLabel?: string;
  /** Internal path (`/book`) or absolute URL. Never build this from WEB_URL. */
  ctaHref?: string;
}

/** Data-bound: renders whatever the org's active services currently are. */
export interface ServicesProps {
  title?: string;
  intro?: string;
  /**
   * Filter by service CATEGORY NAME. Not ids — `organization_service.category`
   * is free text, so these match strings. Named honestly because the agent
   * fills this field, and `categoryIds` would invite it to emit uuids that
   * silently match nothing. Empty/omitted = all active services.
   */
  categoryNames?: string[];
  limit?: number;
  showPrices: boolean;
}

/** Data-bound. */
export interface TeamProps {
  title?: string;
  intro?: string;
  practitionerIds?: string[];
  showBios: boolean;
}

export interface GalleryProps {
  title?: string;
  /** Explicit asset ids; empty = the org photo gallery. */
  assetIds?: string[];
  /** Layout lives in `variant` (see BLOCK_VARIANTS) — it was duplicated here. */
}

/** Data-bound. */
export interface OpeningHoursProps {
  title?: string;
  locationId?: string;
  /** Exceptions are NOT in any public payload yet — see plan §5. */
  showExceptions: boolean;
}

/** Data-bound. */
export interface MapLocationProps {
  title?: string;
  locationId?: string;
  showAddress: boolean;
  showMap: boolean;
}

/** The primary conversion. Cannot be removed from the home page (plan §10). */
export interface CtaBookingProps {
  headline: string;
  subtext?: string;
  buttonLabel: string;
}

export interface RichTextProps {
  /** Sanitized markdown subset. NEVER raw author HTML — that is `custom_html`, a later phase. */
  markdown: string;
  align?: 'left' | 'center';
}

export type Block =
  | BlockBase<'hero', HeroProps>
  | BlockBase<'services', ServicesProps>
  | BlockBase<'team', TeamProps>
  | BlockBase<'gallery', GalleryProps>
  | BlockBase<'opening_hours', OpeningHoursProps>
  | BlockBase<'map_location', MapLocationProps>
  | BlockBase<'cta_booking', CtaBookingProps>
  | BlockBase<'rich_text', RichTextProps>;

/**
 * Emitted as CSS custom properties on the page shell. Blocks only ever read
 * `var(--brand-*)` — a block must never hardcode a colour, or the theme stops
 * being a guardrail and the agent can produce an off-brand page.
 */
export interface MicrositeTheme {
  brand: {
    primary: string;
    accent: string;
    neutral: string;
    surface: string;
  };
  /**
   * ONE mark. There are no light/dark/wordmark variants in this codebase —
   * `ensureLogoVariants` returns the same mark for both, because inverting
   * corrupted coloured logos. Do not reintroduce a variant field.
   */
  logo: { assetUrl: string | null };
  /**
   * No per-org font is stored anywhere (plan §4), so this is a choice from a
   * curated set, not seeded data.
   */
  typography: { scale: 'compact' | 'default' | 'editorial' };
  radius: 'none' | 'sm' | 'md' | 'full';
  buttonStyle: 'solid' | 'outline' | 'pill';
  density: 'tight' | 'comfortable';
}

export interface MicrositeSeo {
  title?: string;
  description?: string;
  ogImageAssetId?: string;
}

export interface MicrositePage {
  id: string;
  path: string;
  title: string;
  seo: MicrositeSeo;
  blocks: Block[];
  order: number;
  /** System pages (booking) cannot be deleted by the agent or the user. */
  isSystem: boolean;
}

/** The unit a revision snapshots, and what the renderer is handed. */
export interface MicrositeDocument {
  theme: MicrositeTheme;
  pages: MicrositePage[];
}

/**
 * The `name` attribute Meta looks for when it crawls a tenant's custom domain
 * to verify ownership (plan §9.4).
 *
 * It lives in the CONTRACT because both sides need it and neither can import
 * the other: the token is read from the database in `features/microsites`, and
 * the tag is emitted by the Astro renderer, which must never reach the
 * database. Duplicating the string is how the two quietly stop matching and
 * verification fails with nothing in the logs.
 */
export const META_DOMAIN_VERIFY_TAG_NAME = 'facebook-domain-verify';
