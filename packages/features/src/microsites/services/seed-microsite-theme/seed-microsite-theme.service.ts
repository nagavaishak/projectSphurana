/**
 * Seed a microsite's theme for an organization.
 *
 * WHY THIS IS NOT `organization.primaryColor`.
 *
 * `primaryColor` is a DEFAULT for much of the estate rather than a chosen
 * brand colour — 14 orgs sit on Tailwind violet-600, 8 on `#7a00df`, 12 on
 * black (see `readBrandPalette` in ../../../image-generation/brand-swatch.ts,
 * which refuses to fold it into a swatch for exactly this reason). Seeding a
 * website from it would ship a large share of tenants a Tailwind-violet site
 * and label it "on-brand" — the single most visible way this feature can fail
 * on day one.
 *
 * So this service repeats the precedence the graphics pipeline already
 * settled on:
 *
 *   1. `readBrandPalette()` over the org's OWN reference posts — the colours
 *      the brand actually publishes in.
 *   2. `getResolvedTheme()` — the validated org row (hex validation, contrast
 *      lint, merge over `engineDefaultTheme`). Reused wholesale; none of that
 *      logic is reimplemented here.
 *   3. Engine defaults — reported as such, never dressed up as brand.
 *
 * HOW A CALLER KNOWS IT GOT DEFAULTS. `MicrositeTheme` is a fixed contract
 * (packages/web-shared/src/microsites/contract.ts) with nowhere to hang
 * provenance, and widening it would ripple through the jsonb columns, the
 * renderer and the agent tools. So provenance is surfaced two ways instead:
 *   - a structured log line per seed (`microsites.theme_seeded`), warn-level
 *     when the colours are pure engine defaults; and
 *   - `isDefaultBrandPalette(theme)`, exported below, so a caller can gate a
 *     "pick your colours" prompt on a boolean rather than on a hunch.
 * A theme that is on defaults is a theme the owner must be asked about — that
 * is the product decision the flag exists to enable.
 */

import { type Database, organization } from '@borradh-workspace/database';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
import {
  type ThemeColors,
  contrastRatio,
  engineDefaultTheme,
} from '@borradh-workspace/video-templates';
import type { MicrositeTheme } from '@borradh-workspace/web-shared';
import { and, eq } from 'drizzle-orm';
import type { BrandPalette } from '../../../image-generation/brand-swatch.js';
import { readBrandPalette } from '../../../image-generation/brand-swatch.js';
// Imported from the defining module rather than its barrel so tests can drive
// it with a restored `vi.spyOn` (the features suite runs `isolate: false`, so
// `vi.mock` on an internal module leaks across files).
import { selectInspirationSet } from '../../../image-generation/services/select-inspiration-set/select-inspiration-set.service.js';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
// The single brand accessor over the `organization` row: hex validation,
// contrast lint and the merge over `engineDefaultTheme` all live there and are
// deliberately not reimplemented here.
import { getResolvedTheme } from '../../../videos/services/get-resolved-theme/get-resolved-theme.service.js';
import {
  type SeedMicrositeThemeInput,
  seedMicrositeThemeSchema,
} from './seed-microsite-theme.schema.js';

const logger = createLogger('SeedMicrositeTheme');

/** Where the seeded brand colours came from. Emitted on every seed. */
export type BrandColourSource = 'brand_imagery' | 'organization' | 'defaults';

/**
 * The colours a microsite gets when NOTHING about the org is knowable. Taken
 * from `engineDefaultTheme` so "default" means one thing across the estate.
 */
export const DEFAULT_MICROSITE_BRAND: MicrositeTheme['brand'] = {
  primary: engineDefaultTheme.colors.primary,
  accent: engineDefaultTheme.colors.accent,
  neutral: engineDefaultTheme.colors.onSurface,
  surface: engineDefaultTheme.colors.surface,
};

/**
 * True when the theme's colours are the engine defaults — i.e. we know nothing
 * about this brand and the site is generic, not "on-brand". Callers should use
 * this to prompt the owner rather than publish silently.
 */
export function isDefaultBrandPalette(theme: MicrositeTheme): boolean {
  return (
    theme.brand.primary.toLowerCase() ===
      DEFAULT_MICROSITE_BRAND.primary.toLowerCase() &&
    theme.brand.accent.toLowerCase() ===
      DEFAULT_MICROSITE_BRAND.accent.toLowerCase() &&
    theme.brand.surface.toLowerCase() ===
      DEFAULT_MICROSITE_BRAND.surface.toLowerCase()
  );
}

/** Longest an individual reference image may take to load. */
const REFERENCE_FETCH_TIMEOUT_MS = 15_000;
/**
 * Minimum contrast a brand colour must have against the page ground to be
 * usable as `primary` (buttons, links). 3.0 is the WCAG threshold for UI
 * components and large text — the roles `--brand-primary` actually fills. The
 * stricter body-text ratio is carried by `neutral`, which is chosen for it.
 */
const MIN_PRIMARY_ON_SURFACE_CONTRAST = 3;
/** Candidate text colours. Neutral must read on the ground, whatever it is. */
const INK = '#111111';
const PAPER = '#FFFFFF';

async function fetchReference(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(REFERENCE_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * The brand's palette from its own posts, or null.
 *
 * Null is returned — never a guess — when the flag is off, when the org has no
 * gated reference set, when nothing loads, or when extraction finds no flat
 * colour. Every one of those is a legitimate "we do not know", and the caller
 * falls through to the org row.
 */
async function readPaletteFromImagery(
  db: Database,
  organizationId: string
): Promise<BrandPalette | null> {
  // `readBrandPalette` is gated behind ENABLE_BRAND_SWATCH in the graphics
  // pipeline; honour the same switch so a single flag governs whether image-
  // derived colour is trusted anywhere.
  if (!process.env.ENABLE_BRAND_SWATCH) return null;

  const set = await selectInspirationSet(db, { organizationId });
  if (!set.success || set.data.urls.length === 0) return null;

  // ORDER MATTERS: `readBrandPalette` treats the FIRST reference as the design
  // model and takes the ground from it. Load in parallel but keep the
  // selection order, dropping failures in place rather than compacting early.
  const loaded = (await Promise.all(set.data.urls.map(fetchReference))).filter(
    (b): b is Buffer => b !== null
  );
  if (loaded.length === 0) return null;

  return readBrandPalette(loaded);
}

/** The text colour that actually reads on this ground. */
function neutralFor(surface: string): string {
  return contrastRatio(INK, surface) >= contrastRatio(PAPER, surface)
    ? INK
    : PAPER;
}

/**
 * Map an extracted palette onto the microsite's four roles.
 *
 * `ground` is the background by construction (it is the colour at the canvas
 * edges), so it becomes `surface`. The accents are ordered most-used first,
 * but the most-used accent is not automatically usable as `primary` — a pale
 * accent on a pale ground gives an invisible button — so primary is the accent
 * that reads best on the ground and `accent` is what remains.
 */
function brandFromPalette(
  palette: BrandPalette
): MicrositeTheme['brand'] | null {
  const surface = palette.ground;
  const ranked = [...palette.accents].sort(
    (a, b) => contrastRatio(b, surface) - contrastRatio(a, surface)
  );
  const primary = ranked[0];
  // No accent at all means the references were a single flat colour — that is
  // a ground, not a palette, and there is nothing to build a page from.
  if (!primary) return null;
  if (contrastRatio(primary, surface) < MIN_PRIMARY_ON_SURFACE_CONTRAST) {
    return null;
  }

  return {
    primary,
    accent: ranked[1] ?? primary,
    neutral: neutralFor(surface),
    surface,
  };
}

/**
 * Map the validated org theme onto the microsite's roles.
 *
 * `secondary` is preferred for `accent` when the org actually set it —
 * `engineDefaultTheme.colors.accent` is a stock blue that belongs to no
 * tenant, so handing it out as "the brand's accent" is the same lie as
 * handing out violet.
 */
function brandFromResolvedTheme(colors: ThemeColors): MicrositeTheme['brand'] {
  const orgSetSecondary =
    colors.secondary.toLowerCase() !==
    engineDefaultTheme.colors.secondary.toLowerCase();

  return {
    primary: colors.primary,
    accent: orgSetSecondary ? colors.secondary : colors.accent,
    neutral: colors.onSurface,
    surface: colors.surface,
  };
}

/**
 * Did the organization row contribute any colour at all? `getResolvedTheme`
 * merges org colours over engine defaults and gives no provenance back, so the
 * only honest test is whether anything moved.
 */
function orgContributedColour(colors: ThemeColors): boolean {
  return (
    colors.primary.toLowerCase() !==
      engineDefaultTheme.colors.primary.toLowerCase() ||
    colors.secondary.toLowerCase() !==
      engineDefaultTheme.colors.secondary.toLowerCase()
  );
}

const seedMicrositeThemeImpl = async (
  db: Database,
  input: SeedMicrositeThemeInput
): Promise<Result<MicrositeTheme>> => {
  const parsed = seedMicrositeThemeSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  const org = await db.query.organization.findFirst({
    where: and(eq(organization.id, organizationId), notDeleted(organization)),
    columns: { logo: true },
  });
  if (!org) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  let brand: MicrositeTheme['brand'] | null = null;
  let source: BrandColourSource = 'defaults';

  // ── 1. The brand's own imagery ───────────────────────────────────
  try {
    const palette = await readPaletteFromImagery(db, organizationId);
    brand = palette ? brandFromPalette(palette) : null;
    if (brand) source = 'brand_imagery';
  } catch (error) {
    // Colour extraction is a nicety, not a precondition. A decode failure or a
    // dead reference URL must not stop an org getting a website.
    logger.warn('Brand palette extraction failed; falling back to org theme', {
      event: 'microsites.brand_palette_unreadable',
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    });
    brand = null;
  }

  // ── 2. The validated organization row ────────────────────────────
  if (!brand) {
    const resolved = await getResolvedTheme(db, { organizationId });
    if (resolved.success) {
      brand = brandFromResolvedTheme(resolved.data.colors);
      source = orgContributedColour(resolved.data.colors)
        ? 'organization'
        : 'defaults';
    } else if (resolved.error.code === ErrorCodes.NOT_FOUND) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
      );
    } else {
      // A theme that fails its own contrast lint is not one to half-trust —
      // take the defaults whole, and say so.
      logger.warn('Resolved org theme unusable; seeding engine defaults', {
        event: 'microsites.org_theme_unusable',
        organizationId,
        reason: resolved.error.message,
      });
      brand = null;
    }
  }

  // ── 3. Engine defaults, declared as such ─────────────────────────
  if (!brand) {
    brand = { ...DEFAULT_MICROSITE_BRAND };
    source = 'defaults';
  }

  const theme: MicrositeTheme = {
    brand,
    /**
     * The CANONICAL stored value, never a signed URL — this theme is persisted
     * to jsonb and a signed URL would expire in the row. The renderer resolves
     * it (`resolveReferenceImageUrl`) at read time.
     *
     * ONE mark: `ensureLogoVariants` returns the same asset for light and dark
     * because inverting recoloured coloured logos, so there is no variant to
     * choose between here.
     */
    logo: { assetUrl: org.logo ?? null },
    /**
     * NOT derived, and cannot be: nothing in the schema stores a per-org
     * typeface. `brandFontImageUrl` is an IMAGE of the org's lettering (for
     * image models) and `videoCaptionFont` is scoped to video captions —
     * neither names a web font. `default` is the curated middle of the three
     * scales; the agent may change it on request.
     */
    typography: { scale: 'default' },
    // Curated house defaults for the same reason: no org row expresses them.
    radius: 'md',
    buttonStyle: 'solid',
    density: 'comfortable',
  };

  const message =
    source === 'defaults'
      ? 'Microsite theme seeded from ENGINE DEFAULTS — not this brand'
      : 'Microsite theme seeded';
  const details = {
    event: 'microsites.theme_seeded',
    organizationId,
    colourSource: source,
    primary: theme.brand.primary,
    surface: theme.brand.surface,
    hasLogo: theme.logo.assetUrl !== null,
  };
  if (source === 'defaults') logger.warn(message, details);
  else logger.info(message, details);

  return ok(theme);
};

export const seedMicrositeTheme = (
  db: Database,
  input: SeedMicrositeThemeInput
) =>
  trackedResult(
    'microsites.seedMicrositeTheme',
    () => seedMicrositeThemeImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type SeedMicrositeThemeResult = Awaited<
  ReturnType<typeof seedMicrositeTheme>
>;
