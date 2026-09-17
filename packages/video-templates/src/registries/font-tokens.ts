import { z } from 'zod';

// Font token registry (§9). A type-style binds to a font token; the renderer
// resolves the token to a Google Fonts (or self-hosted) family and is
// responsible for preloading via delayRender/continueRender (§14).
// `allura` is the cursive script face used by the v1 caption-tease caption
// line; exposing it as a token lets any template pick it per-element via a
// styleOverride.fontRef without baking a face into a type-style role.
export const FONT_TOKENS = ['inter', 'playfair', 'allura'] as const;

export type FontToken = (typeof FONT_TOKENS)[number];

export const fontRef = z.enum(FONT_TOKENS);
