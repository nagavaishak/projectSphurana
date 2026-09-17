import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  beforeEach,
  createMockDatabase,
  describe,
  it,
} from '@borradh-workspace/testing';
import sharp from 'sharp';
import { expect, vi } from 'vitest';
import type { GeminiImageInput } from './gemini-image.js';
import {
  ensureLogoVariants,
  imageLuminanceFromBase64,
  pickLogoForBackground,
} from './logo-variants.js';

// `@borradh-workspace/storage` is a canonically aliased mock (vite.config.ts) —
// no file-local `vi.mock` (it would leak under `isolate: false`). The canonical
// defaults already give the behaviour this suite needs: `parseS3Url` → null and
// `isCdnEnabled` → false, so `resolveReferenceImageUrl` passes stored URLs
// straight through and `persistInverted` is a no-op.

const input = (label: string): GeminiImageInput => ({
  data: `data-${label}`,
  mediaType: 'image/png',
});

/** A PNG of a solid `colour` shape on a transparent canvas, as base64. */
async function logoPng(colour: {
  r: number;
  g: number;
  b: number;
}): Promise<Buffer> {
  const shape = await sharp({
    create: {
      width: 120,
      height: 40,
      channels: 4,
      background: { ...colour, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: 200,
      height: 80,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: shape, gravity: 'center' }])
    .png()
    .toBuffer();
}

/**
 * REAL PRODUCTION LOGOS.
 *
 * Synthesised fixtures could not test this. Two earlier attempts passed for the
 * wrong reasons: a solid rectangle on white is trimmed down to exactly the mark,
 * so there is no transparency left to assert on, and luminance alone cannot tell
 * "the mark is dark" from "the whole rectangle was inverted to black". Only real
 * marks — irregular, with interior gaps and anti-aliased edges — exercise the
 * path the way production does.
 *
 * `__fixtures__/logos/` therefore holds four actual customer logos, downloaded
 * from the public assets bucket:
 *
 *   glitter-girls.jpeg  a small mark on a 1125x2000 portrait field (97.2% ground)
 *   zenelle.jpeg        a dark mark on white, the commonest shape
 *   soleil.jpeg         a pale mark — measures light even after recovery
 *   clearskin4u.png     already has alpha; the control that must not change
 */
const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
  'logos'
);
const fixture = (name: string) => readFileSync(join(FIXTURES, name));

/** Alpha-weighted luminance of the pixels the model would actually see. */
async function visibleLuminance(base64: string): Promise<number> {
  const { data, info } = await sharp(Buffer.from(base64, 'base64'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let lum = 0;
  let alpha = 0;
  for (let i = 0; i + 3 < data.length; i += info.channels) {
    const a = data[i + 3] / 255;
    if (a <= 0.05) continue;
    lum +=
      ((0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255) *
      a;
    alpha += a;
  }
  return alpha > 0 ? lum / alpha : 0.5;
}

/**
 * Share of transparent pixels — the property that DISCRIMINATES.
 *
 * A recovered logo keeps interior and edge transparency even after `.trim()`,
 * because a real mark is not a rectangle. An unrecovered JPEG is 100% opaque.
 */
async function transparentShare(base64: string): Promise<number> {
  const { data, info } = await sharp(Buffer.from(base64, 'base64'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let clear = 0;
  let total = 0;
  for (let i = 0; i + 3 < data.length; i += info.channels) {
    if (data[i + 3] <= 12) clear++;
    total++;
  }
  return total > 0 ? clear / total : 0;
}

/**
 * CAPABILITY: an alpha-less logo is never classified by its background.
 *
 * Polarity is decided by `opaqueLuminance`, which averages only the pixels alpha
 * says are visible. A JPEG has none, so the average becomes the white PAGE
 * rather than the mark. Measured on these very files before the fix:
 *
 *   glitter-girls   0.0% skipped   luminance 0.978   -> called LIGHT
 *   zenelle         0.0% skipped   luminance 0.957   -> called LIGHT
 *   clearskin4u    95.4% skipped   luminance 0.329   -> called DARK (correct)
 *
 * Being called "light" meant a cream slide received the INVERTED copy — a
 * near-black rectangle the model cannot reproduce, so it re-typeset the business
 * name instead. Owners reported it as "our logo keeps being altered". 18 of 59
 * orgs with a logo are JPEG, and they account for 46% of recent graphics.
 */
describe('ensureLogoVariants — real production logos', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const resolve = async (file: string, ext: string) => {
    mockDb._mockResolvedValue('limit', [
      { logo: `https://example.com/logo.${ext}` },
    ]);
    const bytes = fixture(file);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes }))
    );
    const variants = await ensureLogoVariants(mockDb as never, 'org_1');
    vi.unstubAllGlobals();
    return variants;
  };

  it.each([
    ['glitter-girls.jpeg', 'a small mark on a tall field — 97.2% ground'],
    ['zenelle.jpeg', 'a dark mark on white — the commonest shape'],
  ])('recovers the mark from %s (%s)', async (file) => {
    const { light, dark } = await resolve(file, 'jpeg');
    if (!light || !dark) throw new Error('expected a mark');

    // THE GUARD. Without recovery this is 0 — the model gets an opaque
    // rectangle. A real mark keeps transparency even after `.trim()`.
    expect(await transparentShare(dark.data)).toBeGreaterThan(0.2);
    // The surviving pixels are the mark, which is dark. Recovery must not
    // change that; it only removes the page.
    expect(await visibleLuminance(dark.data)).toBeLessThan(0.5);
  });

  it('leaves a logo that already has alpha untouched', async () => {
    // The control. Recovery must not run on a file that already has a mask.
    const { light, dark } = await resolve('clearskin4u.png', 'png');
    if (!light || !dark) throw new Error('expected a mark');
    expect(await visibleLuminance(dark.data)).toBeLessThan(0.5);
  });

  /**
   * THE REGRESSION THIS FILE EXISTS FOR.
   *
   * `light` and `dark` used to be opposite polarities, minted by RGB-inverting
   * the stored logo. That is only a polarity flip for an ACHROMATIC mark; for a
   * coloured one it moves the hue, and it shipped for months. Miso Life's gold
   * #d2ac54 became #2d53ab — blue — and every graphic was handed a blue
   * monogram labelled as their brand mark.
   *
   * The old assertions could not catch it: they checked LUMINANCE, and an
   * inverted gold has exactly the luminance the test wanted. Hue is the axis
   * that was broken, so hue is what this asserts.
   */
  it('never alters the mark — a gold logo does not come back blue', async () => {
    const gold = { r: 210, g: 172, b: 84 };
    const logo = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { ...gold, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    mockDb._mockResolvedValue('limit', [{ logo: 'https://example.com/l.png' }]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => logo }))
    );
    const { light, dark } = await ensureLogoVariants(mockDb as never, 'org_1');
    vi.unstubAllGlobals();
    if (!light || !dark) throw new Error('expected a mark');

    // Same bytes in both slots — there is only ever one mark.
    expect(light.data).toBe(dark.data);

    for (const variant of [light, dark]) {
      const { data } = await sharp(Buffer.from(variant.data, 'base64'))
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      // Gold: red is the largest channel and blue the smallest. Inversion
      // reverses that ordering, which is exactly what made the M blue.
      expect(data[0]).toBeGreaterThan(data[2]);
    }
  });

  it('still returns variants for a pale mark it cannot re-classify', async () => {
    // Soleil measures 0.940 before recovery and 0.684 after — a real mark, but
    // still above the light threshold, so its classification is UNCHANGED.
    // Pinned as-is rather than as a fix: either the mark genuinely is pale, or
    // removal is partial, and nothing here has established which.
    const { light, dark } = await resolve('soleil.jpeg', 'jpeg');
    expect(light).not.toBeNull();
    expect(dark).not.toBeNull();
  });
});

describe('pickLogoForBackground', () => {
  const light = input('light');
  const dark = input('dark');

  it('returns the mark regardless of background', () => {
    // Both slots hold the same mark now, so background luminance selects
    // nothing. Asserted rather than deleted: a future change that reintroduces
    // background-driven selection has to reintroduce a second REAL lockup with
    // it, not a recoloured copy of the first.
    expect(pickLogoForBackground({ light, dark }, 0.1)).toBe(light);
    expect(pickLogoForBackground({ light, dark }, 0.9)).toBe(light);
  });

  it('falls back to the only available variant', () => {
    // Dark background wants the light logo, but only the dark one exists.
    expect(pickLogoForBackground({ light: null, dark }, 0.1)).toBe(dark);
  });

  it('returns null when no variant exists', () => {
    expect(pickLogoForBackground({ light: null, dark: null }, 0.5)).toBeNull();
  });
});

describe('imageLuminanceFromBase64', () => {
  it('reads a black image as ~0 and a white image as ~1', async () => {
    const black = (
      await sharp({
        create: {
          width: 8,
          height: 8,
          channels: 3,
          background: { r: 0, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer()
    ).toString('base64');
    const white = (
      await sharp({
        create: {
          width: 8,
          height: 8,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .png()
        .toBuffer()
    ).toString('base64');

    expect(await imageLuminanceFromBase64(black)).toBeLessThan(0.1);
    expect(await imageLuminanceFromBase64(white)).toBeGreaterThan(0.9);
  });

  it('assumes light (1) on undecodable input', async () => {
    expect(await imageLuminanceFromBase64('not-an-image')).toBe(1);
  });
});

describe('ensureLogoVariants', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns no variants when the org has no logo', async () => {
    mockDb._mockResolvedValue('limit', [{ logo: null }]);
    const variants = await ensureLogoVariants(mockDb as never, 'org_1');
    expect(variants).toEqual({ light: null, dark: null });
  });

  it.each([
    ['white', { r: 255, g: 255, b: 255 }],
    ['black', { r: 0, g: 0, b: 0 }],
  ])(
    'returns the stored %s logo unchanged in both slots',
    async (_name, rgb) => {
      // These two used to assert that the opposite polarity was MINTED — a white
      // logo yielding a black `dark`. That behaviour is gone: an achromatic mark
      // was the only case inversion handled correctly, and keeping it for those
      // orgs alone would have meant a coloured mark still being recoloured.
      mockDb._mockResolvedValue('limit', [
        { logo: 'https://example.com/logo.png' },
      ]);
      const png = await logoPng(rgb);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: true, arrayBuffer: async () => png }))
      );

      const { light, dark } = await ensureLogoVariants(
        mockDb as never,
        'org_1'
      );
      vi.unstubAllGlobals();

      if (!light || !dark) throw new Error('expected a mark');
      expect(light.data).toBe(dark.data);

      const stored = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
      expect(await imageLuminanceFromBase64(light.data)).toBeCloseTo(stored, 1);
    }
  );
});
