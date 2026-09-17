/**
 * The palette axis for grouping a brand's posts.
 *
 * WHY THIS EXISTS. The vision gate labels a post's `colourway` — light-ground,
 * dark-ground, brand-colour-ground, photo-led — and that describes the GROUND,
 * not the palette. Miso Life's sage-green-and-cream wellness posts and their
 * navy-and-gold medical flyers are both `light-ground`, so nothing in that
 * vocabulary could tell them apart. Selection drew from the merged bucket, took
 * the three newest, and handed the model flyers as the reference for a brand
 * whose actual feed is sage and cream.
 *
 * DELIBERATELY NOT A MODEL CALL. Dominant colour is arithmetic. Asking a vision
 * model to name a palette reintroduces exactly the free-text fragmentation the
 * closed colourway vocabulary exists to prevent ("sage", "muted green",
 * "olive"), costs money per image, and is non-deterministic — three properties
 * that make grouping unstable between runs. This reads pixels.
 *
 * COARSE ON PURPOSE. Nine hue families and two ground tones, not a continuous
 * distance. The job is to separate a green brand from a gold one, not to
 * distinguish sage from olive — over-fragmenting is the failure mode that made
 * a four-post campaign outrank a year of house style.
 */

import sharp from 'sharp';

/** Hue families, coarse enough that sage/olive/mint land together. */
export const accentHues = [
  'neutral',
  'red',
  'orange',
  'gold',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
] as const;
export type AccentHue = (typeof accentHues)[number];

export type GroundTone = 'light' | 'dark';

export interface Palette {
  /** Overall ground tone — matches how the post reads at a glance. */
  ground: GroundTone;
  /** The dominant CHROMATIC family, ignoring neutrals. */
  accent: AccentHue;
}

/**
 * Minimum CHROMA (max channel − min channel) for a pixel to vote on the accent.
 *
 * Chroma, not HSL saturation. Saturation is inflated near white: cream
 * (245,242,235) computes s ≈ 0.33 and a hue of 42° — which is "gold" — so a
 * cream GROUND outvoted the actual accent and every warm-white brand collapsed
 * into one family. Cream's chroma is 0.04 against sage's 0.15, which separates
 * them cleanly and means the same thing at every lightness.
 */
const MIN_ACCENT_CHROMA = 0.1;
/** Near-black and near-white carry no hue worth voting with. */
const MIN_ACCENT_LIGHTNESS = 0.12;
const MAX_ACCENT_LIGHTNESS = 0.93;
/** Below this share of the image, there is no accent worth naming. */
const MIN_ACCENT_SHARE = 0.02;
/** Sampling grid. Big enough to be stable, small enough to be instant. */
const SAMPLE_EDGE = 64;

function hueFamily(hueDegrees: number): AccentHue {
  const h = ((hueDegrees % 360) + 360) % 360;
  if (h < 15 || h >= 345) return 'red';
  if (h < 40) return 'orange';
  if (h < 70) return 'gold';
  if (h < 160) return 'green';
  if (h < 200) return 'teal';
  if (h < 260) return 'blue';
  if (h < 300) return 'purple';
  return 'pink';
}

/** Standard RGB → HSL, on 0-1 channels. */
function toHsl(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

/**
 * Read a post's palette. Returns null when the image cannot be decoded —
 * callers treat that as "unknown" rather than guessing a family.
 */
export async function readPalette(image: Buffer): Promise<Palette | null> {
  try {
    const { data, info } = await sharp(image)
      .resize(SAMPLE_EDGE, SAMPLE_EDGE, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    const votes = new Map<AccentHue, number>();
    let lightnessTotal = 0;
    let pixels = 0;
    let accentPixels = 0;

    for (let i = 0; i + channels - 1 < data.length; i += channels) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const { h, l } = toHsl(r, g, b);
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      lightnessTotal += l;
      pixels++;
      if (
        chroma < MIN_ACCENT_CHROMA ||
        l < MIN_ACCENT_LIGHTNESS ||
        l > MAX_ACCENT_LIGHTNESS
      ) {
        continue;
      }
      const family = hueFamily(h);
      // Weight by chroma so a large washed-out region cannot outvote a smaller,
      // genuinely branded one.
      votes.set(family, (votes.get(family) ?? 0) + chroma);
      accentPixels++;
    }

    if (pixels === 0) return null;

    const ground: GroundTone =
      lightnessTotal / pixels >= 0.5 ? 'light' : 'dark';
    if (accentPixels / pixels < MIN_ACCENT_SHARE) {
      return { ground, accent: 'neutral' };
    }
    const [top] = [...votes].sort((a, b) => b[1] - a[1]);
    return { ground, accent: top ? top[0] : 'neutral' };
  } catch {
    return null;
  }
}

/**
 * The grouping key: palette first, then how the post is built.
 *
 * Palette leads because it is what makes two posts look like the same brand at
 * a glance — a sage post and a gold post are not one visual system however
 * similarly they are laid out.
 */
export function designFamilyKey(
  palette: Palette | null,
  layout: string
): string {
  if (!palette) return `unknown|${layout}`;
  return `${palette.ground}-${palette.accent}|${layout}`;
}
