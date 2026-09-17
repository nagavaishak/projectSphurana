import { describe, expect, it } from '@borradh-workspace/testing';
import sharp from 'sharp';
import {
  OFF_DECK_GROUND_DISTANCE,
  buildPaletteSwatch,
  colourDistance,
  readBrandPalette,
  readGroundColour,
} from './brand-swatch.js';

const MINT: [number, number, number] = [184, 210, 202];
const GREEN: [number, number, number] = [43, 133, 83];
const GOLD: [number, number, number] = [206, 168, 85];

/** A flat ground with a solid accent band — a designed post, in miniature. */
async function designedPost(
  ground: [number, number, number],
  accent: [number, number, number]
): Promise<Buffer> {
  const w = 300;
  const h = 300;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const c = y >= 200 && y < 240 ? accent : ground;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      raw[i] = c[0];
      raw[i + 1] = c[1];
      raw[i + 2] = c[2];
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();
}

/**
 * A post that is mostly PHOTOGRAPH — random texture — over a small flat band.
 * Stands in for the clinical posts that dominate a real corpus.
 */
async function photoLedPost(
  band: [number, number, number],
  noiseBase: [number, number, number]
): Promise<Buffer> {
  const w = 300;
  const h = 300;
  const raw = Buffer.alloc(w * h * 3);
  // Deterministic pseudo-noise: a photo is textured, and texture is the thing
  // the flat gate keys on. No Math.random — the assertion must not flake.
  let seed = 7;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      if (y >= 260) {
        raw[i] = band[0];
        raw[i + 1] = band[1];
        raw[i + 2] = band[2];
        continue;
      }
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const jitter = (seed >> 16) % 60;
      raw[i] = Math.min(255, noiseBase[0] + jitter);
      raw[i + 1] = Math.min(255, noiseBase[1] + jitter);
      raw[i + 2] = Math.min(255, noiseBase[2] + jitter);
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();
}

/** Narrows away the null a palette read can legitimately return. */
function must(palette: Awaited<ReturnType<typeof readBrandPalette>>) {
  if (!palette) throw new Error('expected a palette, got null');
  return palette;
}

const dist = (hex: string, c: [number, number, number]) => {
  const v = (hex.replace('#', '').match(/../g) ?? []).map((x) =>
    Number.parseInt(x, 16)
  );
  return Math.sqrt(
    (v[0] - c[0]) ** 2 + (v[1] - c[1]) ** 2 + (v[2] - c[2]) ** 2
  );
};

describe('readBrandPalette', () => {
  it('reads the ground and the accent from a designed post', async () => {
    const palette = await readBrandPalette([await designedPost(MINT, GOLD)]);

    expect(palette).not.toBeNull();
    expect(dist(must(palette).ground, MINT)).toBeLessThan(12);
    expect(must(palette).accents.some((a) => dist(a, GOLD) < 24)).toBe(true);
  });

  // THE CASE THIS EXISTS FOR. A waxing clinic's corpus is mostly skin, and skin
  // recurs in more posts than any brand colour — so plain frequency ranks
  // photography above the brand. Texture is what separates them.
  it('ignores photographic texture and keeps the flat brand colour', async () => {
    const palette = await readBrandPalette([
      await photoLedPost(MINT, [170, 140, 120]),
    ]);

    expect(palette).not.toBeNull();
    expect(dist(must(palette).ground, MINT)).toBeLessThan(20);
  });

  // `organization.primaryColor` is a DEFAULT for much of the estate, so it is
  // deliberately not a source here — a swatch must only carry colours the
  // brand's own posts actually use.
  it('reads only the references, never a registered brand colour', async () => {
    const palette = await readBrandPalette([await designedPost(MINT, GOLD)]);

    expect(must(palette).accents.every((a) => dist(a, GREEN) > 24)).toBe(true);
  });

  // Pooling by raw weight let the WHITEST reference claim the ground — a
  // near-grey at 31.7% of one post beat the brand mint at 15.9% of another, so
  // the declared ground flipped with whichever references happened to load.
  // The ground now comes from the FIRST reference, which is the one the prompt
  // calls the design model.
  it('takes the ground from the design model, not the heaviest reference', async () => {
    const palette = await readBrandPalette([
      await designedPost(MINT, GOLD),
      await designedPost([211, 209, 209], GOLD),
    ]);

    expect(dist(must(palette).ground, MINT)).toBeLessThan(24);
    // The other reference still contributes its colours as accents.
    expect(must(palette).accents.some((a) => dist(a, GOLD) < 24)).toBe(true);
  });

  // A background reaches the canvas edge; type, marks and accent shapes do not.
  // Weighting by CHROMA instead elected the gold accent (chroma 121) over the
  // mint ground (chroma 26).
  it('picks the edge colour as the ground, not the most colourful one', async () => {
    // Gold occupies MORE of the canvas than the mint, but only the mint
    // touches the border.
    const w = 300;
    const h = 300;
    const raw = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const inner = x > 30 && x < 270 && y > 30 && y < 270;
        const c = inner ? GOLD : MINT;
        const i = (y * w + x) * 3;
        raw[i] = c[0];
        raw[i + 1] = c[1];
        raw[i + 2] = c[2];
      }
    }
    const post = await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
      .png()
      .toBuffer();

    const palette = await readBrandPalette([post]);
    expect(dist(must(palette).ground, MINT)).toBeLessThan(24);
  });

  /**
   * THE SCRUBS. A practitioner's uniform is a large SMOOTH region inside a
   * photograph, so a single-scale flatness gate admitted it: `#0a454c` reached
   * a real org's accent slot and dragged a deck's ground from the brand's mint
   * to a teal. What gives it away is not its own texture but its surroundings.
   */
  it('drops a garment-sized smooth patch inside a photograph', async () => {
    const w = 300;
    const h = 300;
    const raw = Buffer.alloc(w * h * 3);
    let seed = 11;
    const UNIFORM: [number, number, number] = [10, 69, 76];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        // Top third: the brand's designed ground. Rest: a photograph, with a
        // big flat garment sitting in the middle of it.
        if (y < 100) {
          raw[i] = MINT[0];
          raw[i + 1] = MINT[1];
          raw[i + 2] = MINT[2];
          continue;
        }
        if (x > 120 && x < 180 && y > 170 && y < 230) {
          // Cloth, not paint: real garments carry folds and shading, and that
          // gentle structure is what the wide window sees. A PERFECTLY flat
          // large region inside a photograph would still pass — see the
          // module's note on the limits of this test.
          const fold = Math.round(10 * Math.sin((x - 90) / 9));
          raw[i] = Math.max(0, UNIFORM[0] + fold);
          raw[i + 1] = Math.max(0, UNIFORM[1] + fold);
          raw[i + 2] = Math.max(0, UNIFORM[2] + fold);
          continue;
        }
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const jitter = (seed >> 16) % 70;
        raw[i] = Math.min(255, 150 + jitter);
        raw[i + 1] = Math.min(255, 120 + jitter);
        raw[i + 2] = Math.min(255, 100 + jitter);
      }
    }
    const post = await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
      .png()
      .toBuffer();

    const palette = must(await readBrandPalette([post]));

    expect(dist(palette.ground, MINT)).toBeLessThan(20);
    expect(palette.accents.every((a) => dist(a, UNIFORM) > 40)).toBe(true);
  });

  it('returns null with no references and no brand colour', async () => {
    expect(await readBrandPalette([])).toBeNull();
  });

  it('survives a reference that will not decode', async () => {
    const palette = await readBrandPalette([
      Buffer.from('not an image'),
      await designedPost(MINT, GOLD),
    ]);

    expect(dist(must(palette).ground, MINT)).toBeLessThan(12);
  });
});

describe('buildPaletteSwatch', () => {
  // Role is carried by AREA — a label inside the image would be text, and text
  // is exactly what this mechanism exists to avoid relying on.
  it('gives the ground the majority of the canvas', async () => {
    const png = await buildPaletteSwatch(
      { ground: '#b8d2ca', accents: ['#2b8553', '#cea855'] },
      120
    );
    const { data, info } = await sharp(png)
      .raw()
      .toBuffer({ resolveWithObject: true });

    let groundPixels = 0;
    for (let i = 0; i < info.width * info.height; i++) {
      if (
        dist('#b8d2ca', [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]]) < 4
      ) {
        groundPixels++;
      }
    }
    expect(groundPixels / (info.width * info.height)).toBeGreaterThan(0.6);
  });

  it('renders every accent', async () => {
    const png = await buildPaletteSwatch(
      { ground: '#b8d2ca', accents: ['#2b8553', '#cea855'] },
      120
    );
    const { data, info } = await sharp(png)
      .raw()
      .toBuffer({ resolveWithObject: true });

    const present = (hex: string) => {
      for (let i = 0; i < info.width * info.height; i++) {
        if (dist(hex, [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]]) < 4) {
          return true;
        }
      }
      return false;
    };
    expect(present('#2b8553')).toBe(true);
    expect(present('#cea855')).toBe(true);
  });

  it('handles a palette with no accents', async () => {
    const png = await buildPaletteSwatch(
      { ground: '#b8d2ca', accents: [] },
      60
    );
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(60);
  });
});

describe('deck colour consistency', () => {
  it('measures a slide ground and the distance between two', async () => {
    const mint = await designedPost(MINT, GOLD);
    const gold = await designedPost(GOLD, MINT);

    const a = await readGroundColour(mint);
    const b = await readGroundColour(gold);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(colourDistance(a as string, b as string)).toBeGreaterThan(
      OFF_DECK_GROUND_DISTANCE
    );
  });

  // The threshold sits in an OBSERVED GAP: coherent decks span 5–38 between
  // their slides, wandered slides sit 143–223. Nothing landed in between.
  it('treats a near-identical ground as on-deck', async () => {
    const a = await readGroundColour(await designedPost(MINT, GOLD));
    const b = await readGroundColour(await designedPost([180, 206, 198], GOLD));

    expect(colourDistance(a as string, b as string)).toBeLessThan(
      OFF_DECK_GROUND_DISTANCE
    );
  });
});
