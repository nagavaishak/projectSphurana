import { describe, expect, it } from '@borradh-workspace/testing';
import sharp from 'sharp';
import {
  DUPLICATE_HASH_DISTANCE,
  computeDhash,
  hashDistance,
  isDuplicateImage,
} from './dhash.js';

/** A deterministic gradient — the kind of smooth image dHash is designed for. */
async function gradient(width = 200, height = 200, shift = 0): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const value = (x + shift) % 256;
      raw[i] = value;
      raw[i + 1] = value;
      raw[i + 2] = value;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

/** Vertical bars — structurally unlike a horizontal gradient. */
async function bars(width = 200, height = 200): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const value = Math.floor(x / 10) % 2 === 0 ? 20 : 235;
      raw[i] = value;
      raw[i + 1] = value;
      raw[i + 2] = value;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

describe('computeDhash', () => {
  it('returns a 16-char hex hash', async () => {
    const hash = await computeDhash(await gradient());
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns null for a buffer that is not an image', async () => {
    expect(await computeDhash(Buffer.from('not an image'))).toBeNull();
  });
});

describe('isDuplicateImage — the cross-platform copy case', () => {
  // The real defect: Facebook and Instagram each re-encode the SAME post, so
  // the bytes differ and the image does not. A byte digest would miss this.
  it('treats the same image re-encoded at a different quality as duplicate', async () => {
    const original = await gradient();
    const reencoded = await sharp(original).jpeg({ quality: 45 }).toBuffer();

    expect(await sharp(original).toBuffer()).not.toEqual(reencoded);
    expect(
      isDuplicateImage(
        await computeDhash(original),
        await computeDhash(reencoded)
      )
    ).toBe(true);
  });

  it('treats the same image rescaled as duplicate', async () => {
    const original = await gradient(400, 400);
    const smaller = await sharp(original).resize(160, 160).toBuffer();
    expect(
      isDuplicateImage(
        await computeDhash(original),
        await computeDhash(smaller)
      )
    ).toBe(true);
  });

  it('does NOT collapse structurally different images', async () => {
    const distance = hashDistance(
      await computeDhash(await gradient()),
      await computeDhash(await bars())
    );
    expect(distance).not.toBeNull();
    expect(distance as number).toBeGreaterThan(DUPLICATE_HASH_DISTANCE);
  });
});

describe('hashDistance', () => {
  it('is 0 for identical hashes', () => {
    expect(hashDistance('ffffffffffffffff', 'ffffffffffffffff')).toBe(0);
  });

  it('counts differing bits', () => {
    // 0x0 vs 0xf in the last nibble = 4 differing bits.
    expect(hashDistance('0000000000000000', '000000000000000f')).toBe(4);
  });

  it('returns null on a missing or malformed hash, so callers do not collapse rows', () => {
    expect(hashDistance(null, 'ffffffffffffffff')).toBeNull();
    expect(hashDistance('ffff', 'ffffffffffffffff')).toBeNull();
    expect(hashDistance('zzzzzzzzzzzzzzzz', 'ffffffffffffffff')).toBeNull();
    // …and that "unknown" must not read as "duplicate".
    expect(isDuplicateImage(null, 'ffffffffffffffff')).toBe(false);
  });
});
