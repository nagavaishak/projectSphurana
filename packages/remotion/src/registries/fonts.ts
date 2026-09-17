// Fonts registry (§9, §14).
//
// Resolves a FontToken to a font-family string and a loader that registers the
// font with the browser via @remotion/google-fonts. The loader internally uses
// delayRender/continueRender so first-frame paint blocks until fonts are ready
// — without this, headlines flash unstyled before the woff2s land.
//
// The TemplateDoc only references fonts indirectly: a TypeStyleToken resolves
// to a ResolvedTypeStyle that carries a fontFamily string. preloadFonts() walks
// the RenderDoc, dedupes by family, and triggers the matching loader.

import type { FontToken } from '@borradh-workspace/video-templates';
import type { ResolvedTypeStyle } from '@borradh-workspace/video-templates';
import {
  fontFamily as alluraFontFamily,
  loadFont as loadAllura,
} from '@remotion/google-fonts/Allura';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { fontFamily as interFontFamily } from '@remotion/google-fonts/Inter';
import {
  loadFont as loadPlayfair,
  fontFamily as playfairFontFamily,
} from '@remotion/google-fonts/PlayfairDisplay';

export interface FontEntry {
  /** The CSS font-family value that ResolvedTypeStyle.fontFamily must include. */
  family: string;
  /** Weights we register with the browser. */
  weights: readonly number[];
  /** Triggers delayRender/continueRender via @remotion/google-fonts. */
  load: () => void;
}

const FONTS: Record<FontToken, FontEntry> = {
  inter: {
    family: interFontFamily,
    weights: [400, 500, 700],
    load: () => {
      loadInter('normal', {
        weights: ['400', '500', '700'],
        subsets: ['latin'],
      });
    },
  },
  playfair: {
    family: playfairFontFamily,
    weights: [400, 700],
    load: () => {
      loadPlayfair('normal', { weights: ['400', '700'], subsets: ['latin'] });
    },
  },
  // Cursive script face (v1 caption-tease caption). Single weight; latin only —
  // a bare loadFont() registers every subset/variant, each its own delayRender,
  // which times out the Lambda render.
  allura: {
    family: alluraFontFamily,
    weights: [400],
    load: () => {
      loadAllura('normal', { weights: ['400'], subsets: ['latin'] });
    },
  },
};

export function getFontEntry(token: FontToken): FontEntry {
  return FONTS[token];
}

// Maps a ResolvedTypeStyle.fontFamily (CSS string like `"Inter, system-ui, ..."`)
// back to the FontToken that owns it. Used by preloadFonts to dedupe.
function familyToToken(family: string): FontToken | null {
  const head = family
    .split(',')[0]
    ?.trim()
    .replace(/^["']|["']$/g, '');
  if (!head) return null;
  if (head === interFontFamily || head === 'Inter') return 'inter';
  if (head === playfairFontFamily || head === 'Playfair Display') {
    return 'playfair';
  }
  if (head === alluraFontFamily || head === 'Allura') return 'allura';
  return null;
}

// Preloads every font referenced by the resolved type-styles in a RenderDoc.
// Call once at mount; idempotent — @remotion/google-fonts dedupes internally.
export function preloadFonts(typeStyles: ResolvedTypeStyle[]): void {
  const seen = new Set<FontToken>();
  for (const style of typeStyles) {
    const token = familyToToken(style.fontFamily);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    FONTS[token].load();
  }
}

// Re-export the family strings so callers can reference them without round-
// tripping through getFontEntry.
export const FONT_FAMILIES = {
  inter: interFontFamily,
  playfair: playfairFontFamily,
  allura: alluraFontFamily,
} as const;
