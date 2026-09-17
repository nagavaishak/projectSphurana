// Theme (§17 Theming & brand).
//
// Renderer-agnostic Theme shape. Mirrors the brand_kit DB table but in an
// ergonomic form for the synthesis pipeline. The compiler (Phase B) reads
// from this; the brand_kit table is the persistence layer.
//
// RESOLUTION CASCADE (locked):
//
//   engineDefaultTheme  →  brandKit (org)  →  themeOverrides (per-video)
//                                                       ↓
//                                              resolved Theme baked into
//                                              RenderDoc.globals.theme
//
// Each layer overrides the prior; missing layers fall through.
//
// THEME IS A SYNTHESIS INPUT, NOT EMBEDDED IN TEMPLATEDOC. TemplateDocs cite
// roles + tokens (display/heading/body/caption + font tokens). The synthesizer
// multiplies TemplateDoc × Theme → on-brand RenderDoc. The renderer never
// looks up a Theme — it reads the resolved type-styles baked into RenderDoc.

import { z } from 'zod';
import { type FontToken, fontRef } from './registries/font-tokens.js';
import type { TypeStyleToken } from './registries/type-style-tokens.js';

// ── Theme typeStyle override ────────────────────────────────────────
// A Theme can override font choice, weight, case, and tracking per type-style
// role. Size + color stay the engine's responsibility (size comes from the
// engine's per-role default; color comes from the colour role binding).

export const themeTypeStyleSchema = z.object({
  fontRef,
  weight: z.number().int().min(100).max(900),
  case: z.enum(['upper', 'normal']),
  /** em units. */
  tracking: z.number(),
});

export type ThemeTypeStyle = z.infer<typeof themeTypeStyleSchema>;

// ── Theme colours ───────────────────────────────────────────────────
// Semantic colour roles. Hex strings (e.g. '#0066FF').

const hexColor = z
  .string()
  .regex(
    /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/,
    'expected hex colour'
  );

export const themeColorsSchema = z.object({
  primary: hexColor,
  secondary: hexColor,
  accent: hexColor,
  surface: hexColor,
  onSurface: hexColor,
  onPrimary: hexColor,
  muted: hexColor,
});

export type ThemeColors = z.infer<typeof themeColorsSchema>;

// ── Theme logos ─────────────────────────────────────────────────────

export const themeLogoSchema = z.object({
  light: z.string().url().nullable(),
  dark: z.string().url().nullable(),
});

export type ThemeLogo = z.infer<typeof themeLogoSchema>;

// ── Theme identity ──────────────────────────────────────────────────

export const themeIdentitySchema = z.object({
  businessName: z.string().min(1),
  tagline: z.string().nullable(),
  address: z.string().nullable(),
  ctaText: z.string().min(1),
  bookingUrl: z.string().url().nullable(),
  currency: z.string().min(3).max(3),
});

export type ThemeIdentity = z.infer<typeof themeIdentitySchema>;

// ── Theme music ─────────────────────────────────────────────────────

export const themeMusicSchema = z.object({
  preferredMoods: z.array(z.string()),
});

export type ThemeMusic = z.infer<typeof themeMusicSchema>;

// ── Top-level Theme ─────────────────────────────────────────────────

export const themeSchema = z.object({
  colors: themeColorsSchema,
  logo: themeLogoSchema,
  typeStyles: z.object({
    display: themeTypeStyleSchema,
    heading: themeTypeStyleSchema,
    body: themeTypeStyleSchema,
    caption: themeTypeStyleSchema,
  }),
  identity: themeIdentitySchema,
  music: themeMusicSchema,
  tone: z.string().nullable(),
});

export type Theme = z.infer<typeof themeSchema>;

// ── DeepPartial<Theme> for per-video overrides ──────────────────────
// Per-video themeOverrides take precedence over the org's brand_kit. Each
// branch is optional; missing branches fall through to the brand_kit / engine
// defaults.

export type ThemeOverrides = {
  colors?: Partial<ThemeColors>;
  logo?: Partial<ThemeLogo>;
  typeStyles?: Partial<Record<TypeStyleToken, Partial<ThemeTypeStyle>>>;
  identity?: Partial<ThemeIdentity>;
  music?: Partial<ThemeMusic>;
  tone?: string | null;
};

export const themeOverridesSchema: z.ZodType<ThemeOverrides> = z.object({
  colors: themeColorsSchema.partial().optional(),
  logo: themeLogoSchema.partial().optional(),
  typeStyles: z
    .object({
      display: themeTypeStyleSchema.partial().optional(),
      heading: themeTypeStyleSchema.partial().optional(),
      body: themeTypeStyleSchema.partial().optional(),
      caption: themeTypeStyleSchema.partial().optional(),
    })
    .partial()
    .optional(),
  identity: themeIdentitySchema.partial().optional(),
  music: themeMusicSchema.partial().optional(),
  tone: z.string().nullable().optional(),
});

// ── engineDefaultTheme ──────────────────────────────────────────────
// The fallback the compiler uses when no brand_kit exists for an org. Also
// the bottom of the resolution cascade — any theme value the brand_kit /
// per-video overrides don't supply comes from here.
//
// Choices mirror wave 3's `getTypeStyle` engine fallback so existing rendered
// videos look identical when no brand_kit row exists.

export const engineDefaultTheme: Theme = {
  colors: {
    primary: '#000000',
    secondary: '#666666',
    accent: '#0066FF',
    surface: '#FFFFFF',
    onSurface: '#000000',
    onPrimary: '#FFFFFF',
    muted: '#999999',
  },
  logo: {
    light: null,
    dark: null,
  },
  typeStyles: {
    display: {
      fontRef: 'playfair' as FontToken,
      weight: 700,
      case: 'upper',
      tracking: -0.02,
    },
    heading: {
      fontRef: 'inter' as FontToken,
      weight: 700,
      case: 'normal',
      tracking: -0.01,
    },
    body: {
      fontRef: 'inter' as FontToken,
      weight: 500,
      case: 'normal',
      tracking: 0,
    },
    caption: {
      fontRef: 'inter' as FontToken,
      weight: 500,
      case: 'upper',
      tracking: 0.02,
    },
  },
  identity: {
    businessName: 'Untitled Business',
    tagline: null,
    address: null,
    ctaText: 'Book now',
    bookingUrl: null,
    currency: 'USD',
  },
  music: {
    preferredMoods: [],
  },
  tone: null,
};

// ── Theme merge helper ──────────────────────────────────────────────
// Deep merge: each later layer overrides the previous one. Used by
// get-resolved-theme. Theme is shallow enough that a hand-written merge is
// clearer than pulling in lodash.

export function mergeTheme(base: Theme, overrides: ThemeOverrides): Theme {
  return {
    colors: { ...base.colors, ...(overrides.colors ?? {}) },
    logo: { ...base.logo, ...(overrides.logo ?? {}) },
    typeStyles: {
      display: {
        ...base.typeStyles.display,
        ...(overrides.typeStyles?.display ?? {}),
      },
      heading: {
        ...base.typeStyles.heading,
        ...(overrides.typeStyles?.heading ?? {}),
      },
      body: { ...base.typeStyles.body, ...(overrides.typeStyles?.body ?? {}) },
      caption: {
        ...base.typeStyles.caption,
        ...(overrides.typeStyles?.caption ?? {}),
      },
    },
    identity: { ...base.identity, ...(overrides.identity ?? {}) },
    music: { ...base.music, ...(overrides.music ?? {}) },
    tone: overrides.tone === undefined ? base.tone : overrides.tone,
  };
}

// ── Contrast lint helper ────────────────────────────────────────────
// Pure function — no deps. Computes the WCAG-style contrast ratio between
// two hex colours. Used by synthesis to surface a structured error when a
// Theme's primary/onPrimary pair is unreadable.

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.match(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/);
  if (!m) return null;
  let v = m[1];
  if (!v) return null;
  if (v.length === 3) {
    const v0 = v[0] ?? '';
    const v1 = v[1] ?? '';
    const v2 = v[2] ?? '';
    v = v0 + v0 + v1 + v1 + v2 + v2;
  }
  if (v.length === 8) v = v.slice(0, 6); // ignore alpha for luminance
  const r = Number.parseInt(v.slice(0, 2), 16);
  const g = Number.parseInt(v.slice(2, 4), 16);
  const b = Number.parseInt(v.slice(4, 6), 16);
  return { r, g, b };
}

function relativeLuminance({
  r,
  g,
  b,
}: { r: number; g: number; b: number }): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(hexA: string, hexB: string): number {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return 0;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

// Minimum contrast for primary/onPrimary. Below this the synthesizer surfaces
// a structured VALIDATION_ERROR per §15.3 / §17.
export const MIN_PRIMARY_CONTRAST = 3.0;
