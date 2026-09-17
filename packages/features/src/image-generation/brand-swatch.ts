/**
 * The brand's palette, handed to the image model as a PICTURE.
 *
 * WHY THIS EXISTS. §16 named brand hexes in the prompt four times and never
 * reproduced one. §17 found why, and it is not the wording: an org's reference
 * set is often entirely `photo-led`, and a photo-led post HAS NO GROUND to
 * teach. Nothing in the request said what the background should be, so the
 * model invented one per generation — five references, five unrelated grounds,
 * measured. The hex was the only ground signal in the request and it was in
 * text, which this model does not obey.
 *
 * It does obey images: slides follow a supplied cover within Δ7 across 30
 * samples, and flat-gated extraction recovers a brand's registered green from
 * its own post to a distance of 1. So the palette is passed as a swatch.
 *
 * Measured against the two references production actually sends for one org:
 * canvas on-palette rose from a median 48.9% (range 31–66%) to 74.4% (range
 * 74–78%). The consistency gain is the point — the ground stops varying run to
 * run, which is the defect that produced two off-colour slides in a five-slide
 * deck.
 *
 * ROLE IS ENCODED BY AREA, not by labels. A caption inside the swatch is still
 * text. The ground colour fills it and the accents take narrow bands, so
 * "which of these is the background" is legible without a word.
 */

import sharp from 'sharp';

export interface BrandPalette {
  /** The background colour — the largest flat, chromatic-or-neutral region. */
  ground: string;
  /** Type, mark and accent colours, most-used first. */
  accents: string[];
}

/** Analysis edge. Big enough to keep texture, small enough to stay instant. */
const ANALYSIS_EDGE = 384;
/**
 * Flatness is measured at TWO SCALES, and a palette colour must pass both.
 *
 * Small window: ground and type interiors are locally flat, photographic
 * midtones are not. This is what keeps skin out — plain frequency cannot,
 * because in a waxing clinic's corpus skin recurs in 29 of 102 posts and
 * outranks every brand colour.
 *
 * It is NOT enough on its own, which was measured: a practitioner's dark teal
 * scrubs are a large SMOOTH region, so they passed the small window and landed
 * in the accent slot as `#0a454c`. On a swatch that dragged a deck's ground
 * from the brand's mint to a teal (`#b0cdc4` declared, `#64a89e` produced).
 *
 * What separates a garment from a brand colour is not its own texture but its
 * SURROUNDINGS: a smooth patch inside a photograph still sits in a neighbour-
 * hood full of detail, whereas a designed ground is calm at every scale. So a
 * colour must be flat in a small window AND in a wide one.
 *
 * HOW IT ACTUALLY WORKS, AND ITS LIMIT. The wide window only rejects pixels
 * whose neighbourhood contains detail, which for a region larger than the
 * window means its BORDER. So this does not exclude a garment outright — it
 * erodes it, and the remainder falls below `MIN_SHARE`. That is why it removed
 * a real org's scrubs (2.6% of the flat pixels, gone) and why the effect is
 * SIZE-DEPENDENT: a big enough flat region keeps a core that survives.
 *
 * A genuinely flat, large region inside a photograph — a seamless backdrop, a
 * blown-out wall — is therefore still admitted. Telling that from a designed
 * ground needs semantics, not arithmetic, which is the argument for having a
 * vision model label the measured clusters rather than invent the values.
 */
const FLAT_WINDOW = 9;
const FLAT_MAX_SD = 3;
/** The wide window — "is this inside a photograph?" */
const CONTEXT_WINDOW = 41;
const CONTEXT_MAX_SD = 14;
/** Merge radius. Without it a raw top-N is four shades of one colour. */
const MERGE_DISTANCE = 24;
/** Below this share of the canvas a colour is not part of the palette. */
const MIN_SHARE = 0.01;
const MAX_ACCENTS = 2;

const distance = (a: number[], b: number[]) =>
  Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

const toHex = (c: number[]) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

const fromHex = (h: string): number[] =>
  (h.replace('#', '').match(/../g) ?? ['0', '0', '0']).map((x) =>
    Number.parseInt(x, 16)
  );

/** Per-pixel local stddev of luma over a box window, via integral images. */
function flatnessMap(
  data: Buffer,
  w: number,
  h: number
): { local: Float32Array; context: Float32Array } {
  const n = w * h;
  const lum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lum[i] =
      0.299 * data[i * 3] + 0.587 * data[i * 3 + 1] + 0.114 * data[i * 3 + 2];
  }
  const stride = w + 1;
  const s = new Float64Array(stride * (h + 1));
  const s2 = new Float64Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = lum[y * w + x];
      const k = (y + 1) * stride + (x + 1);
      s[k] = v + s[k - 1] + s[k - stride] - s[k - stride - 1];
      s2[k] = v * v + s2[k - 1] + s2[k - stride] - s2[k - stride - 1];
    }
  }
  const box = (
    t: Float64Array,
    x0: number,
    y0: number,
    x1: number,
    y1: number
  ) =>
    t[(y1 + 1) * stride + (x1 + 1)] -
    t[y0 * stride + (x1 + 1)] -
    t[(y1 + 1) * stride + x0] +
    t[y0 * stride + x0];

  // Both scales come off the SAME integral images, so the wide window is
  // effectively free.
  const atRadius = (radius: number) => {
    const sd = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(h - 1, y + radius);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - radius);
        const x1 = Math.min(w - 1, x + radius);
        const count = (x1 - x0 + 1) * (y1 - y0 + 1);
        const mean = box(s, x0, y0, x1, y1) / count;
        const variance = box(s2, x0, y0, x1, y1) / count - mean * mean;
        sd[y * w + x] = Math.sqrt(Math.max(0, variance));
      }
    }
    return sd;
  };
  return {
    local: atRadius(FLAT_WINDOW >> 1),
    context: atRadius(CONTEXT_WINDOW >> 1),
  };
}

interface Cluster {
  c: number[];
  weight: number;
  /** Share of this colour's pixels that sit in the canvas's border ring. */
  border: number;
}

/** Fraction of the shorter edge treated as "the border ring". */
const BORDER_FRACTION = 0.06;

/** Flat-gated, merged dominant colours of one image, largest share first. */
async function flatColours(image: Buffer): Promise<Cluster[]> {
  const { data, info } = await sharp(image)
    .resize(ANALYSIS_EDGE, ANALYSIS_EDGE, { fit: 'inside' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const { local, context } = flatnessMap(data, w, h);
  const margin = Math.round(Math.min(w, h) * BORDER_FRACTION);
  const buckets = new Map<
    number,
    { n: number; edge: number; r: number; g: number; b: number }
  >();
  for (let i = 0; i < w * h; i++) {
    // Flat in itself AND calm in its surroundings — see the two-scale note.
    if (local[i] > FLAT_MAX_SD || context[i] > CONTEXT_MAX_SD) continue;
    const x = i % w;
    const y = (i / w) | 0;
    const onEdge =
      x < margin || x >= w - margin || y < margin || y >= h - margin;
    const r = data[i * 3];
    const g = data[i * 3 + 1];
    const b = data[i * 3 + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const e = buckets.get(key);
    if (e) {
      e.n++;
      e.r += r;
      e.g += g;
      e.b += b;
      if (onEdge) e.edge++;
    } else buckets.set(key, { n: 1, edge: onEdge ? 1 : 0, r, g, b });
  }

  const sorted = [...buckets.values()]
    .map((e) => ({
      c: [e.r / e.n, e.g / e.n, e.b / e.n],
      weight: e.n / (w * h),
      border: e.edge / (w * h),
    }))
    .sort((a, b) => b.weight - a.weight);

  const merged: Cluster[] = [];
  for (const cand of sorted) {
    const near = merged.find((m) => distance(m.c, cand.c) <= MERGE_DISTANCE);
    if (near) {
      const total = near.weight + cand.weight;
      near.c = near.c.map(
        (v, j) => (v * near.weight + cand.c[j] * cand.weight) / total
      );
      near.weight = total;
      near.border += cand.border;
    } else
      merged.push({ c: [...cand.c], weight: cand.weight, border: cand.border });
    // The tail is noise; merging all of it costs time and changes nothing.
    if (merged.length > 40) break;
  }
  return merged
    .filter((m) => m.weight >= MIN_SHARE)
    .sort((a, b) => b.weight - a.weight);
}

/**
 * Read the palette from the brand's own reference posts.
 *
 * Reads the REFERENCES rather than a rendered graphic on purpose: a render has
 * already drifted, so snapping a deck to its own cover only makes a wrong hue
 * consistent.
 *
 * DELIBERATELY DOES NOT USE `organization.primaryColor`. It is a DEFAULT for
 * much of the estate rather than a chosen brand colour — 14 orgs sit on
 * Tailwind violet-600, 8 on #7a00df, 12 on black — so folding it in injects a
 * colour the brand does not use. Tried: for one org it put #669C35 on a swatch
 * whose brand is #2b8553 and #b8d2ca. A brand's own posts are the only source
 * here; with nothing extractable the caller gets null and sends no swatch,
 * which is the honest answer.
 */
export async function readBrandPalette(
  references: Buffer[]
): Promise<BrandPalette | null> {
  if (references.length === 0) return null;

  const perReference: Cluster[][] = [];
  for (const ref of references) {
    try {
      perReference.push(await flatColours(ref));
    } catch {
      // A reference that will not decode is not fatal — the others still speak.
    }
  }
  if (perReference.length === 0) return null;

  /**
   * THE GROUND COMES FROM THE DESIGN MODEL, AND IS THE COLOUR AT THE EDGES.
   *
   * Two corrections, both learned the hard way on one org's two references:
   *
   * 1. POOLING across references let the whitest one claim the ground — a
   *    near-grey at 31.7% of one post beat the brand's mint at 15.9% of the
   *    other, so the declared ground flipped with whichever loaded. The first
   *    reference is the one the prompt calls THE DESIGN MODEL, so the palette
   *    should come from the post we are telling the model to imitate.
   *
   * 2. Weighting by CHROMA to rescue the mint overshot and elected the gold —
   *    an accent with chroma 121 against the mint's 26. The ground is not the
   *    most colourful thing on a canvas.
   *
   * A background touches the canvas EDGE; type, marks and accent shapes
   * generally do not. That is the property that actually distinguishes it, and
   * it needs no magic constant tuned by eye.
   */
  const model = perReference[0];
  const ground = [...model].sort((a, b) => b.border - a.border)[0];
  if (!ground) return null;

  const pooled: Cluster[] = [];
  for (const colours of perReference) {
    for (const c of colours) {
      const near = pooled.find((p) => distance(p.c, c.c) <= MERGE_DISTANCE);
      if (near) {
        const total = near.weight + c.weight;
        near.c = near.c.map(
          (v, j) => (v * near.weight + c.c[j] * c.weight) / total
        );
        near.weight = total;
        near.border += c.border;
      } else pooled.push({ ...c, c: [...c.c] });
    }
  }

  const accents = pooled
    .sort((a, b) => b.weight - a.weight)
    .filter((p) => distance(p.c, ground.c) > MERGE_DISTANCE)
    .slice(0, MAX_ACCENTS)
    .map((p) => toHex(p.c));

  return { ground: toHex(ground.c), accents };
}

/**
 * Render the palette as a swatch image.
 *
 * The ground fills the canvas and each accent takes a band along the bottom, so
 * the largest area IS the background colour. No labels: a word inside an image
 * is still text, and text is the thing this does not rely on.
 */
export async function buildPaletteSwatch(
  palette: BrandPalette,
  edge = 512
): Promise<Buffer> {
  const raw = Buffer.alloc(edge * edge * 3);
  const ground = fromHex(palette.ground);
  for (let i = 0; i < edge * edge; i++) {
    raw[i * 3] = ground[0];
    raw[i * 3 + 1] = ground[1];
    raw[i * 3 + 2] = ground[2];
  }
  const bandHeight = Math.max(
    1,
    Math.floor(edge / ((palette.accents.length || 1) * 6))
  );
  palette.accents.forEach((accent, k) => {
    const c = fromHex(accent);
    const y0 = edge - (k + 1) * bandHeight;
    for (let y = Math.max(0, y0); y < y0 + bandHeight && y < edge; y++) {
      for (let x = 0; x < edge; x++) {
        const i = (y * edge + x) * 3;
        raw[i] = c[0];
        raw[i + 1] = c[1];
        raw[i + 2] = c[2];
      }
    }
  });
  return sharp(raw, { raw: { width: edge, height: edge, channels: 3 } })
    .png()
    .toBuffer();
}

/** The manifest line for the swatch. Says what it is NOT, first. */
export const PALETTE_SWATCH_ROLE =
  'the brand COLOUR PALETTE — a swatch, NOT a design and NOT subject matter, and it must not appear anywhere in the output. The colour filling most of it is the BACKGROUND colour of this graphic; the narrow bands are its accent colours. Reproduce these colours exactly';

/**
 * A rendered slide's own ground colour — the same reading used on references.
 *
 * Exists so a DECK can be checked against itself. Every input that should pin a
 * slide's colour is already present and correct in the slides that go wrong
 * (verified from the request manifest), so the residual failure is sampling,
 * not a missing instruction — and sampling is caught by looking at the output,
 * not by adding another input.
 */
export async function readGroundColour(png: Buffer): Promise<string | null> {
  const palette = await readBrandPalette([png]);
  return palette?.ground ?? null;
}

/** Euclidean RGB distance between two hex colours. */
export function colourDistance(a: string, b: string): number {
  return distance(fromHex(a), fromHex(b));
}

/**
 * How far a slide's ground may sit from the cover's before it is off-deck.
 *
 * Measured over seven decks (35 slides). Slides in a coherent deck sit within
 * 38 of their cover; slides that have wandered measured 71, 76, 132, 143, 158
 * and 223. So the true boundary is between 38 and 71, not the "38 to 143" a
 * first pass suggested — that gap was an artefact of looking only at decks
 * rendered WITH a swatch, and the original problem deck's two bad slides land
 * at 71 and 76. Set midway, at 55, so neither side is caught by a single unit.
 *
 * Replayed over those decks this flags every slide known to have wandered and
 * none of the 16 slides in the four coherent decks.
 *
 * The observed rate was 4 slides in 30 (~13%), occurring singly and at random
 * positions — uncorrelated with re-renders, accents, reference set or the order
 * of the input images, all of which were tested and ruled out.
 */
export const OFF_DECK_GROUND_DISTANCE = 55;
