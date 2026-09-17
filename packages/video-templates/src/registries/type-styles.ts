// Type-styles registry (§9, §17).
//
// Resolves a TypeStyleToken to a concrete ResolvedTypeStyle at Phase B compile
// time. The output is baked into the RenderDoc, so the renderer never looks up
// tokens at render time — it just applies the resolved style object.
//
// Sizes/weights assume a 1080-tall portrait canvas as the design baseline; the
// renderer may scale uniformly for landscape/square if needed.
//
// THEME RESOLUTION (wave 5):
//
// When called without a Theme, returns the engine defaults verbatim. When
// called with a Theme, overlays the theme's per-token typeStyles (fontRef,
// weight, case, tracking) and the theme's onSurface/onPrimary colour roles
// onto the engine defaults. The engine still owns the *size* defaults — the
// Theme only carries font/weight/case/tracking + colour roles.

import type { ResolvedTypeStyle } from '../render-doc.js';
import type { Theme } from '../theme.js';
import type { FontToken } from './font-tokens.js';
import type { TypeStyleToken } from './type-style-tokens.js';

const INTER = 'Inter, system-ui, sans-serif';
const PLAYFAIR = '"Playfair Display", Georgia, serif';
const ALLURA = 'Allura, "Brush Script MT", cursive';

// Map a FontToken to its CSS font-family string. Centralised here so the
// renderer's preload pass and Phase B's resolution agree. Exported so a
// per-element `styleOverride.fontRef` resolves to the same family string the
// renderer preloads.
export function fontFamilyForToken(token: FontToken): string {
  switch (token) {
    case 'inter':
      return INTER;
    case 'playfair':
      return PLAYFAIR;
    case 'allura':
      return ALLURA;
  }
}

// Engine fallback type-styles. Per-role, with sensible defaults for a
// 1080-tall portrait canvas. The Theme can override font/weight/case/tracking
// per role; size + base colour stay engine-owned.
interface EngineDefault {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  letterSpacing: number;
  textTransform: 'none' | 'uppercase';
  color: string;
}

const ENGINE_DEFAULTS: Record<TypeStyleToken, EngineDefault> = {
  display: {
    fontFamily: PLAYFAIR,
    fontSize: 96,
    fontWeight: 700,
    letterSpacing: -0.02,
    textTransform: 'uppercase',
    color: '#FFFFFF',
  },
  heading: {
    fontFamily: INTER,
    fontSize: 56,
    fontWeight: 700,
    letterSpacing: -0.01,
    textTransform: 'none',
    color: '#FFFFFF',
  },
  body: {
    fontFamily: INTER,
    fontSize: 36,
    fontWeight: 500,
    letterSpacing: 0,
    textTransform: 'none',
    color: '#FFFFFF',
  },
  caption: {
    fontFamily: INTER,
    fontSize: 24,
    fontWeight: 500,
    letterSpacing: 0.02,
    textTransform: 'uppercase',
    color: '#FFFFFFCC',
  },
};

// Which colour role each type-style binds to by default. The Theme's
// `colors.onSurface` / `colors.onPrimary` override the engine fallback colour.
//
// Today every default binds to onSurface (the canonical "text on the page"
// colour). Future per-role tweaking (e.g. caption → muted) lives here.
const COLOR_BINDING: Record<TypeStyleToken, 'onSurface' | 'onPrimary'> = {
  display: 'onSurface',
  heading: 'onSurface',
  body: 'onSurface',
  caption: 'onSurface',
};

export function getTypeStyle(
  token: TypeStyleToken,
  theme?: Theme
): ResolvedTypeStyle {
  const base = ENGINE_DEFAULTS[token];
  if (!theme) return { ...base };

  const themeStyle = theme.typeStyles[token];
  const bindingRole = COLOR_BINDING[token];
  const themeColor = theme.colors[bindingRole];

  return {
    fontFamily: fontFamilyForToken(themeStyle.fontRef),
    fontSize: base.fontSize,
    fontWeight: themeStyle.weight,
    letterSpacing: themeStyle.tracking,
    textTransform: themeStyle.case === 'upper' ? 'uppercase' : 'none',
    color: themeColor,
  };
}

// Convenience for callers that want every default in one shot (e.g.
// engine-capability export for §15.2).
export function listDefaultTypeStyles(): Record<
  TypeStyleToken,
  ResolvedTypeStyle
> {
  return {
    display: { ...ENGINE_DEFAULTS.display },
    heading: { ...ENGINE_DEFAULTS.heading },
    body: { ...ENGINE_DEFAULTS.body },
    caption: { ...ENGINE_DEFAULTS.caption },
  };
}
