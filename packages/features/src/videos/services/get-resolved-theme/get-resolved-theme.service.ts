import { type Database, organization } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  MIN_PRIMARY_CONTRAST,
  type Theme,
  contrastRatio,
  engineDefaultTheme,
  mergeTheme,
  themeSchema,
} from '@borradh-workspace/video-templates';
import { and, eq } from 'drizzle-orm';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type GetResolvedThemeInput,
  getResolvedThemeSchema,
} from './get-resolved-theme.schema.js';

// Resolves the active Theme for an organization (§17 resolution cascade).
//
// Cascade order:
//
//   engineDefaultTheme  →  organization row  →  themeOverrides (per-video)
//                                                          ↓
//                                                  resolved Theme
//
// The Theme is derived from the `organization` row (businessName + logo +
// primary/secondary colour + identity fields), layered on top of
// engineDefaultTheme. Anything the org row doesn't define falls through to
// engine defaults via mergeTheme.
//
// The contrast lint runs at the end on the fully-resolved Theme. If
// primary/onPrimary fails (ratio < MIN_PRIMARY_CONTRAST), returns a
// structured FeatureError(VALIDATION_ERROR) per §15.3 / §17.

async function getResolvedThemeImpl(
  db: Database,
  input: GetResolvedThemeInput
): Promise<Result<Theme>> {
  const parsed = getResolvedThemeSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Invalid getResolvedTheme input',
        { issues: parsed.error.issues }
      )
    );
  }

  const { organizationId, themeOverrides } = parsed.data;

  // ── Layer 1: engine defaults ──────────────────────────────────────
  let resolved = engineDefaultTheme;

  // ── Layer 2: organization row ─────────────────────────────────────
  // Derive what we can from the organization row so the resolved Theme has a
  // real businessName / logo / primary colour when downstream slots ask for
  // it. Anything not set here falls through to engine defaults.
  const org = await db.query.organization.findFirst({
    where: and(eq(organization.id, organizationId), notDeleted(organization)),
    columns: {
      name: true,
      logo: true,
      primaryColor: true,
      secondaryColor: true,
      tagline: true,
      address: true,
      defaultBookingLink: true,
    },
  });
  if (!org) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }
  const primaryColor = isValidHex(org.primaryColor) ? org.primaryColor : null;
  const secondaryColor = isValidHex(org.secondaryColor)
    ? org.secondaryColor
    : null;
  resolved = mergeTheme(resolved, {
    colors: {
      ...(primaryColor ? { primary: primaryColor } : {}),
      ...(secondaryColor ? { secondary: secondaryColor } : {}),
    },
    logo: {
      light: org.logo ?? null,
    },
    identity: {
      businessName: org.name || 'Untitled Business',
      tagline: org.tagline ?? null,
      address: org.address ?? null,
      bookingUrl:
        org.defaultBookingLink && isValidUrl(org.defaultBookingLink)
          ? org.defaultBookingLink
          : null,
    },
  });

  // ── Layer 3: per-video overrides ──────────────────────────────────
  if (themeOverrides) {
    resolved = mergeTheme(resolved, themeOverrides);
  }

  // ── Final validation ──────────────────────────────────────────────
  // Re-validate through the Zod schema. Catches malformed brand_kit rows
  // (e.g. an unparseable hex stored from a legacy import) without throwing.
  const validated = themeSchema.safeParse(resolved);
  if (!validated.success) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Resolved theme failed validation',
        { issues: validated.error.issues }
      )
    );
  }

  // ── Contrast lint (§15.3, §17) ────────────────────────────────────
  const ratio = contrastRatio(
    validated.data.colors.primary,
    validated.data.colors.onPrimary
  );
  if (ratio < MIN_PRIMARY_CONTRAST) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        `theme contrast too low for primary/onPrimary (${ratio.toFixed(2)} < ${MIN_PRIMARY_CONTRAST})`,
        {
          primary: validated.data.colors.primary,
          onPrimary: validated.data.colors.onPrimary,
          ratio,
        }
      )
    );
  }

  return ok(validated.data);
}

function isValidHex(s: string | null | undefined): boolean {
  if (!s) return false;
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(s);
}

function isValidUrl(s: string | null | undefined): boolean {
  if (!s) return false;
  try {
    void new URL(s);
    return true;
  } catch {
    return false;
  }
}

export const getResolvedTheme = (db: Database, input: GetResolvedThemeInput) =>
  trackedResult(
    'videos.getResolvedTheme',
    () => getResolvedThemeImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type GetResolvedThemeResult = Awaited<
  ReturnType<typeof getResolvedTheme>
>;
