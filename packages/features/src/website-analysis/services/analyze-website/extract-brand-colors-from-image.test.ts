import { describe, expect, it } from '@borradh-workspace/testing';
import sharp from 'sharp';

import {
  extractBrandColorsFromImage,
  filterBrandColors,
} from './extract-visual-assets.js';

/** Build a flat RGB image of a single color. */
async function solid(
  r: number,
  g: number,
  b: number,
  size = 64
): Promise<Buffer> {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r, g, b },
    },
  })
    .png()
    .toBuffer();
}

/** Build a mostly-white image with a saturated block in the center. */
async function whiteWithBlock(
  r: number,
  g: number,
  b: number
): Promise<Buffer> {
  const size = 120;
  const block = await sharp({
    create: {
      width: 40,
      height: 40,
      channels: 3,
      background: { r, g, b },
    },
  })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([{ input: block, top: 40, left: 40 }])
    .png()
    .toBuffer();
}

describe('extractBrandColorsFromImage', () => {
  it('returns the dominant saturated color from a solid image', async () => {
    // Teal #0d9488 → quantized to 4 bits/channel = #009080
    const colors = await extractBrandColorsFromImage(await solid(13, 148, 136));
    expect(colors.length).toBeGreaterThan(0);
    expect(colors[0]).toBe('#009080');
  });

  it('ignores a white background and surfaces the brand block', async () => {
    const colors = await extractBrandColorsFromImage(
      await whiteWithBlock(220, 20, 60) // crimson
    );
    expect(colors.length).toBeGreaterThan(0);
    // Quantized crimson: 220&0xf0=208(d0), 20&0xf0=16(10), 60&0xf0=48(30)
    expect(colors[0]).toBe('#d01030');
  });

  it('returns [] for an all-neutral (white/grey/black) image', async () => {
    const colors = await extractBrandColorsFromImage(
      await solid(245, 245, 245)
    );
    expect(colors).toEqual([]);
  });

  it('returns [] on undecodable input instead of throwing', async () => {
    const colors = await extractBrandColorsFromImage(
      Buffer.from('not an image')
    );
    expect(colors).toEqual([]);
  });
});

describe('filterBrandColors', () => {
  it('keeps saturated brand colors, drops neutrals and near-white backgrounds', () => {
    // #6a5fda brand purple kept; #e2e8f0 light bg, #241b13 near-black, #ffffff dropped
    const result = filterBrandColors([
      '#e2e8f0',
      '#6a5fda',
      '#ffffff',
      '#a1a6ff',
    ]);
    expect(result).toContain('#6a5fda');
    expect(result).toContain('#a1a6ff');
    expect(result).not.toContain('#e2e8f0');
    expect(result).not.toContain('#ffffff');
  });

  it('preserves input rank order', () => {
    expect(filterBrandColors(['#228496', '#293896'])).toEqual([
      '#228496',
      '#293896',
    ]);
  });

  it('de-duplicates case-insensitively', () => {
    expect(filterBrandColors(['#228496', '#228496', '#228496'])).toEqual([
      '#228496',
    ]);
  });

  it('drops low-saturation greys', () => {
    expect(filterBrandColors(['#808080', '#7a7a7a'])).toEqual([]);
  });
});
