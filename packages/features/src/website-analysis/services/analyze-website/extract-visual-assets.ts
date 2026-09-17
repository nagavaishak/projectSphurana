/**
 * Extract visual brand assets (colors, logo) from HTML and screenshots.
 *
 * HTML helpers are pure regex functions; the screenshot palette uses sharp to
 * quantize real pixels (the reliable signal for JS-rendered sites whose colors
 * live in external CSS bundles the native fetch never inlines).
 */

import sharp from 'sharp';
import { resolveUrl } from './url-utilities.js';

// Common non-brand colors (black, white, grays) to drop from any source.
const NON_BRAND_COLORS = new Set([
  '#000',
  '#000000',
  '#fff',
  '#ffffff',
  '#333',
  '#333333',
  '#666',
  '#666666',
  '#999',
  '#999999',
  '#ccc',
  '#cccccc',
  '#eee',
  '#eeeeee',
  '#f5f5f5',
  '#fafafa',
]);

// CSS variable names that signal an intentional brand color.
const BRAND_VAR_NAME =
  /(primary|secondary|brand|accent|theme|main|highlight|cta)/i;

/**
 * Extract potential brand colors from HTML/CSS.
 *
 * Colors bound to brand-named CSS variables (`--primary`, `--brand`, …) and the
 * `theme-color` meta tag are returned FIRST, since they're high-signal; weaker
 * inline-style matches follow. Order matters: downstream the AI is told to
 * prefer the earliest extracted colors.
 */
export function extractColorsFromHtml(html: string): string[] {
  const brand: string[] = [];
  const other: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string | undefined, isBrand: boolean): void => {
    if (!raw) return;
    const color = raw.toLowerCase();
    if (seen.has(color)) return;
    seen.add(color);
    (isBrand ? brand : other).push(color);
  };

  // CSS variables — capture the var name so brand-named vars rank first.
  for (const m of html.matchAll(
    /--([a-zA-Z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,6})/g
  )) {
    add(m[2], BRAND_VAR_NAME.test(m[1]));
  }

  // theme-color meta tag (strong brand signal)
  const themeColorMatch = html.match(
    /<meta[^>]*name=["']theme-color["'][^>]*content=["'](#[0-9a-fA-F]{3,6})["']/i
  );
  if (themeColorMatch?.[1]) {
    add(themeColorMatch[1], true);
  }

  // Common CSS property patterns (weaker signal)
  const colorPatterns = [
    /background-color:\s*(#[0-9a-fA-F]{3,6})/gi,
    /background:\s*(#[0-9a-fA-F]{3,6})/gi,
    /color:\s*(#[0-9a-fA-F]{3,6})/gi,
    /border-color:\s*(#[0-9a-fA-F]{3,6})/gi,
  ];
  for (const pattern of colorPatterns) {
    for (const match of html.matchAll(pattern)) {
      add(match[1], false);
    }
  }

  return [...brand, ...other].filter((c) => !NON_BRAND_COLORS.has(c));
}

/**
 * Filter a ranked list of hex colors (e.g. from computed DOM styles) down to
 * plausible brand colors: drop blacks/whites/greys and washed-out neutrals,
 * normalize to lowercase, and de-duplicate while preserving rank order.
 */
export function filterBrandColors(hexes: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of hexes) {
    const hex = raw.toLowerCase();
    if (seen.has(hex)) continue;
    seen.add(hex);
    if (NON_BRAND_COLORS.has(hex)) continue;
    const rgb = hexToRgb(hex);
    if (!rgb) continue;
    const { sat, lum } = rgbToSatLum(rgb.r, rgb.g, rgb.b);
    // Drop light backgrounds (a brand PRIMARY is never near-white), near-black
    // text/shadows, and low-saturation greys.
    if (lum > 0.85 || lum < 0.07 || sat < 0.15) continue;
    out.push(hex);
  }
  return out;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return null;
  return {
    r: Number.parseInt(h.slice(0, 2), 16),
    g: Number.parseInt(h.slice(2, 4), 16),
    b: Number.parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Saturation + lightness (0–1) from 8-bit RGB, for neutral filtering. */
function rgbToSatLum(
  r: number,
  g: number,
  b: number
): { sat: number; lum: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lum = (max + min) / 2;
  const delta = max - min;
  const sat = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lum - 1));
  return { sat, lum };
}

/**
 * Extract dominant brand colors from a rendered-page screenshot.
 *
 * Decodes the image to raw pixels, drops near-white/near-black/low-saturation
 * neutrals (backgrounds and body text), then ranks the remaining colors by
 * frequency. Returns up to `max` visually-distinct hex codes (primary first).
 *
 * Returns [] on any decode error so callers can fall back gracefully.
 */
export async function extractBrandColorsFromImage(
  image: Buffer,
  max = 3
): Promise<string[]> {
  try {
    const { data, info } = await sharp(image)
      .resize(96, 96, { fit: 'inside', withoutEnlargement: true })
      // Composite any transparency over white so alpha pixels don't skew.
      .flatten({ background: '#ffffff' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    type Bucket = {
      count: number;
      r: number;
      g: number;
      b: number;
      sat: number;
    };
    const buckets = new Map<string, Bucket>();

    for (let i = 0; i + 2 < data.length; i += channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const { sat, lum } = rgbToSatLum(r, g, b);
      // Skip backgrounds (near-white), text/shadows/dark sections (near-black)
      // and washed-out greys (low saturation) — none of these are the usable
      // brand color. The 0.14 low cutoff drops near-blacks that dominate by
      // area while keeping genuine dark navies (lum ~0.2+).
      if (lum > 0.93 || lum < 0.14 || sat < 0.2) continue;
      // Quantize to 4 bits/channel so near-identical shades merge into one bucket.
      const qr = r & 0xf0;
      const qg = g & 0xf0;
      const qb = b & 0xf0;
      const key = `${qr},${qg},${qb}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.count++;
      } else {
        buckets.set(key, { count: 1, r: qr, g: qg, b: qb, sat });
      }
    }

    // Rank by "vividness" = frequency × saturation, so a prominent brand hue
    // outranks a large dark/muted region (headers, photos). Pure frequency
    // would surface near-black or skin tones ahead of the actual brand color.
    const ranked = [...buckets.values()].sort(
      (a, b) => b.count * b.sat - a.count * a.sat
    );

    const picked: Bucket[] = [];
    for (const c of ranked) {
      // Keep colors visually distinct from ones already picked.
      const tooClose = picked.some(
        (p) =>
          Math.abs(p.r - c.r) + Math.abs(p.g - c.g) + Math.abs(p.b - c.b) < 64
      );
      if (!tooClose) picked.push(c);
      if (picked.length >= max) break;
    }

    return picked.map((c) => rgbToHex(c.r, c.g, c.b));
  } catch {
    return [];
  }
}

/**
 * Extract potential logo URL from HTML.
 */
export function extractLogoFromHtml(
  html: string,
  baseUrl: string
): string | null {
  // Try to find og:image or twitter:image
  const ogImageMatch = html.match(
    /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i
  );
  if (ogImageMatch?.[1]) {
    return resolveUrl(ogImageMatch[1], baseUrl);
  }

  const twitterImageMatch = html.match(
    /<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i
  );
  if (twitterImageMatch?.[1]) {
    return resolveUrl(twitterImageMatch[1], baseUrl);
  }

  // Look for logo in common patterns
  const logoPatterns = [
    /<img[^>]*class=["'][^"']*logo[^"']*["'][^>]*src=["']([^"']+)["']/i,
    /<img[^>]*src=["']([^"']+logo[^"']+)["']/i,
    /<img[^>]*alt=["'][^"']*logo[^"']*["'][^>]*src=["']([^"']+)["']/i,
    /<link[^>]*rel=["']icon["'][^>]*href=["']([^"']+)["']/i,
  ];

  for (const pattern of logoPatterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return resolveUrl(match[1], baseUrl);
    }
  }

  return null;
}
