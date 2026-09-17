import { describe, expect, it } from '@borradh-workspace/testing';
import sharp from 'sharp';
import { designFamilyKey, readPalette } from './palette.js';

/** A flat ground with a band of accent across the middle. */
async function post(
  ground: [number, number, number],
  accent: [number, number, number],
  accentRows = 20
): Promise<Buffer> {
  const w = 100;
  const h = 100;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const c = y >= 40 && y < 40 + accentRows ? accent : ground;
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

const CREAM: [number, number, number] = [245, 242, 235];
const SAGE: [number, number, number] = [106, 133, 96];
const GOLD: [number, number, number] = [193, 152, 46];
const NAVY: [number, number, number] = [26, 42, 82];

describe('readPalette', () => {
  // THE CASE THIS EXISTS FOR. Miso Life's sage wellness posts and their
  // navy/gold medical flyers are BOTH `light-ground` to the vision gate, so
  // selection merged them and handed the model flyers as the reference for a
  // brand whose feed is sage and cream.
  it('separates two light-ground brands by their accent', async () => {
    const sage = await readPalette(await post(CREAM, SAGE));
    const gold = await readPalette(await post(CREAM, GOLD));

    expect(sage?.ground).toBe('light');
    expect(gold?.ground).toBe('light');
    expect(sage?.accent).toBe('green');
    expect(gold?.accent).toBe('gold');
    expect(designFamilyKey(sage, 'type-led-panel')).not.toBe(
      designFamilyKey(gold, 'type-led-panel')
    );
  });

  it('reads a dark ground as dark', async () => {
    const p = await readPalette(await post(NAVY, GOLD));
    expect(p?.ground).toBe('dark');
  });

  it('calls an image with no saturated colour neutral', async () => {
    const p = await readPalette(await post(CREAM, [120, 120, 120]));
    expect(p?.accent).toBe('neutral');
    expect(p?.ground).toBe('light');
  });

  // Coarse on purpose: over-fragmenting is the failure that let a four-post
  // campaign outrank a year of house style.
  it('puts nearby greens in one family', async () => {
    const sage = await readPalette(await post(CREAM, [106, 133, 96]));
    const olive = await readPalette(await post(CREAM, [128, 140, 74]));
    const mint = await readPalette(await post(CREAM, [122, 160, 130]));
    expect(sage?.accent).toBe('green');
    expect(olive?.accent).toBe('green');
    expect(mint?.accent).toBe('green');
  });

  it('is stable across re-encoding and rescaling', async () => {
    const original = await post(CREAM, SAGE);
    const reencoded = await sharp(original).jpeg({ quality: 45 }).toBuffer();
    const smaller = await sharp(original).resize(40, 40).toBuffer();
    const a = await readPalette(original);
    expect(await readPalette(reencoded)).toEqual(a);
    expect(await readPalette(smaller)).toEqual(a);
  });

  it('returns null for something that is not an image', async () => {
    expect(await readPalette(Buffer.from('nope'))).toBeNull();
  });
});

describe('designFamilyKey', () => {
  it('combines palette and layout', async () => {
    const p = await readPalette(await post(CREAM, SAGE));
    expect(designFamilyKey(p, 'type-led-panel')).toBe(
      'light-green|type-led-panel'
    );
  });

  it('marks an unreadable palette rather than guessing a family', () => {
    // Guessing would silently merge it into a real family and pollute the pick.
    expect(designFamilyKey(null, 'minimal-type')).toBe('unknown|minimal-type');
  });
});
